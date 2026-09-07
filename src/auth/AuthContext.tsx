import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as client from '../data/client'
import type { AuthSession } from '../types'

type AuthContextValue = {
  session: AuthSession | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  switchWorkspace: (workspaceId: number) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      setSession(await client.getMe())
    } catch {
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const logout = async () => {
    await client.logout()
    setSession(null)
  }

  const switchWorkspace = async (workspaceId: number) => {
    await client.switchWorkspace(workspaceId)
    // A full reload is the simple correct default here — every page's data
    // hook would otherwise need its own "the workspace changed under me"
    // refetch path. Worth optimizing only if this proves annoying in practice.
    window.location.href = '/'
  }

  return <AuthContext.Provider value={{ session, loading, refresh, logout, switchWorkspace }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
