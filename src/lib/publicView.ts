import { createContext, useContext } from 'react'

// True on a page for visitors without an account (PublicApp.tsx). A shared
// page uses it to hide workspace controls and to call the public API.
export const PublicViewContext = createContext(false)

export function usePublicView(): boolean {
  return useContext(PublicViewContext)
}
