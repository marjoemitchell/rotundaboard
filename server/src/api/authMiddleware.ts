// Session verification + the workspace/role context every workspace-scoped
// route needs. This is the actual fix for the old "acting as" hole: identity
// and workspace are read here, server-side, off a row only the server could
// have created — never trusted from anything the client sends per-request.
import type { NextFunction, Request, Response } from 'express'
import { pool } from '../db.js'
import { generateToken, hashToken } from '../auth/tokens.js'
import { MutationError } from './mutations.js'

export const SESSION_COOKIE_NAME = 'rb_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: number; workspaceId: number; role: 'admin' | 'member' }
    }
  }
}

export async function createSession(userId: number, workspaceId: number | null): Promise<string> {
  const rawToken = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await pool.query(
    'INSERT INTO user_sessions (id, user_id, current_workspace_id, expires_at) VALUES ($1, $2, $3, $4)',
    [hashToken(rawToken), userId, workspaceId, expiresAt],
  )
  return rawToken
}

export async function destroySession(rawToken: string): Promise<void> {
  await pool.query('DELETE FROM user_sessions WHERE id = $1', [hashToken(rawToken)])
}

export async function destroyAllSessionsForUser(userId: number): Promise<void> {
  await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [userId])
}

// In production the frontend and API are deployed as separate Railway
// services on different subdomains, which browsers treat as different
// sites — SameSite=Lax would silently drop the cookie on every
// credentialed fetch() from the frontend's origin. None (+ Secure, which
// None requires) is the correct setting once they're cross-site; Lax stays
// fine for local dev, where both run on http://localhost at different
// ports (same site).
function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
  }
}

function setSessionCookie(res: Response, rawToken: string) {
  res.cookie(SESSION_COOKIE_NAME, rawToken, { ...sessionCookieOptions(), maxAge: SESSION_TTL_MS })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions())
}

export async function issueSession(res: Response, userId: number, workspaceId: number | null) {
  const rawToken = await createSession(userId, workspaceId)
  setSessionCookie(res, rawToken)
}

type SessionRow = {
  user_id: number
  current_workspace_id: number | null
  expires_at: string
  role: 'admin' | 'member' | null
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
  if (!rawToken) {
    res.status(401).json({ error: 'not authenticated' })
    return
  }

  const { rows } = await pool.query<SessionRow>(
    `SELECT s.user_id, s.current_workspace_id, s.expires_at, wm.role
     FROM user_sessions s
     LEFT JOIN workspace_members wm ON wm.workspace_id = s.current_workspace_id AND wm.user_id = s.user_id
     WHERE s.id = $1`,
    [hashToken(rawToken)],
  )
  const session = rows[0]
  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    clearSessionCookie(res)
    res.status(401).json({ error: 'session expired' })
    return
  }
  if (!session.current_workspace_id || !session.role) {
    res.status(401).json({ error: 'no active workspace' })
    return
  }

  pool.query('UPDATE user_sessions SET last_seen_at = now() WHERE id = $1', [hashToken(rawToken)]).catch(() => {})

  req.auth = { userId: session.user_id, workspaceId: session.current_workspace_id, role: session.role }
  next()
}

// Invite/role/membership management is restricted to workspace admins — the
// workspace creator becomes the first admin automatically (see auth.ts).
export function requireAdmin(req: Request): void {
  if (req.auth?.role !== 'admin') throw new MutationError(403, 'admin role required')
}
