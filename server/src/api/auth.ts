import { Router } from 'express'
import type { Request, Response } from 'express'
import { pool } from '../db.js'
import { hashPassword, verifyPassword } from '../auth/passwords.js'
import { generateToken, hashToken } from '../auth/tokens.js'
import { sendEmail } from '../auth/email.js'
import { deriveInitials, pickColor } from '../auth/userDisplay.js'
import { clearSessionCookie, destroyAllSessionsForUser, destroySession, issueSession, SESSION_COOKIE_NAME } from './authMiddleware.js'
import { MutationError } from './mutations.js'

export const authRouter = Router()

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function handleAuthError(res: Response, path: string, err: unknown) {
  if (err instanceof MutationError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(`${path} failed:`, err)
  res.status(500).json({ error: 'internal error' })
}

async function getUserWorkspaces(userId: number) {
  const { rows } = await pool.query<{ id: number; name: string; role: 'admin' | 'member' }>(
    `SELECT w.id, w.name, wm.role
     FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1
     ORDER BY wm.created_at ASC`,
    [userId],
  )
  return rows
}

authRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name, workspaceName, inviteToken } = req.body as {
      email?: string
      password?: string
      name?: string
      workspaceName?: string
      inviteToken?: string
    }
    if (!email?.trim() || !EMAIL_RE.test(email.trim())) throw new MutationError(400, 'a valid email is required')
    if (!password || password.length < 8) throw new MutationError(400, 'password must be at least 8 characters')
    if (!name?.trim()) throw new MutationError(400, 'name is required')
    if (!inviteToken && !workspaceName?.trim()) throw new MutationError(400, 'workspace name is required')

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()])
    if (existing.length > 0) throw new MutationError(409, 'an account with this email already exists')

    // Signing up with an invite token joins that invite's workspace at its
    // role instead of creating a new one — validated inside the same
    // transaction so a token can't be redeemed twice by a race.
    let invite: { id: number; workspace_id: number; role: 'admin' | 'member' } | null = null
    if (inviteToken) {
      const { rows } = await pool.query<{ id: number; workspace_id: number; role: 'admin' | 'member' }>(
        `SELECT id, workspace_id, role FROM workspace_invites
         WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [hashToken(inviteToken)],
      )
      if (rows.length === 0) throw new MutationError(400, 'this invite is invalid or has expired')
      invite = rows[0]
    }

    const passwordHash = await hashPassword(password)
    const client = await pool.connect()
    let userId: number
    let workspaceId: number
    try {
      await client.query('BEGIN')
      const userResult = await client.query<{ id: number }>(
        `INSERT INTO users (email, name, initials, color, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [email.trim().toLowerCase(), name.trim(), deriveInitials(name), pickColor(email.trim().toLowerCase()), passwordHash],
      )
      userId = userResult.rows[0].id

      if (invite) {
        workspaceId = invite.workspace_id
        await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
          workspaceId,
          userId,
          invite.role,
        ])
        await client.query('UPDATE workspace_invites SET accepted_at = now() WHERE id = $1', [invite.id])
      } else {
        const workspaceResult = await client.query<{ id: number }>(
          'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
          [workspaceName!.trim()],
        )
        workspaceId = workspaceResult.rows[0].id
        await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [
          workspaceId,
          userId,
          'admin',
        ])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    await issueSession(res, userId, workspaceId)
    res.status(201).json({ id: userId })
  } catch (err) {
    handleAuthError(res, 'POST /api/auth/signup', err)
  }
})

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string }
    const genericError = new MutationError(401, 'invalid email or password')
    if (!email?.trim() || !password) throw genericError

    const { rows } = await pool.query<{ id: number; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    )
    if (rows.length === 0 || !(await verifyPassword(password, rows[0].password_hash))) throw genericError

    const workspaces = await getUserWorkspaces(rows[0].id)
    await issueSession(res, rows[0].id, workspaces[0]?.id ?? null)
    res.json({ id: rows[0].id })
  } catch (err) {
    handleAuthError(res, 'POST /api/auth/login', err)
  }
})

authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
    if (rawToken) await destroySession(rawToken)
    clearSessionCookie(res)
    res.status(204).end()
  } catch (err) {
    handleAuthError(res, 'POST /api/auth/logout', err)
  }
})

authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string }
    if (email?.trim()) {
      const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()])
      if (rows.length > 0) {
        const rawToken = generateToken()
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
        await pool.query('INSERT INTO password_reset_tokens (id, user_id, expires_at) VALUES ($1, $2, $3)', [
          hashToken(rawToken),
          rows[0].id,
          expiresAt,
        ])
        const link = `${process.env.APP_BASE_URL ?? 'http://localhost:5173'}/reset-password?token=${rawToken}`
        await sendEmail(
          email.trim(),
          'Reset your Rotunda Board password',
          `<p>Click the link below to set a new password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p>`,
        )
      }
    }
    // Always 200, regardless of whether the email exists — no account enumeration.
    res.status(200).json({ ok: true })
  } catch (err) {
    handleAuthError(res, 'POST /api/auth/forgot-password', err)
  }
})

authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string }
    if (!token) throw new MutationError(400, 'token is required')
    if (!newPassword || newPassword.length < 8) throw new MutationError(400, 'password must be at least 8 characters')

    const { rows } = await pool.query<{ id: string; user_id: number }>(
      'SELECT id, user_id FROM password_reset_tokens WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()',
      [hashToken(token)],
    )
    if (rows.length === 0) throw new MutationError(400, 'this reset link is invalid or has expired')

    const passwordHash = await hashPassword(newPassword)
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, rows[0].user_id])
    await pool.query('UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1', [rows[0].id])
    // A password reset should invalidate anything an attacker had — including
    // the session that was open when the reset was requested.
    await destroyAllSessionsForUser(rows[0].user_id)

    const workspaces = await getUserWorkspaces(rows[0].user_id)
    await issueSession(res, rows[0].user_id, workspaces[0]?.id ?? null)
    res.status(200).json({ ok: true })
  } catch (err) {
    handleAuthError(res, 'POST /api/auth/reset-password', err)
  }
})

authRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
    if (!rawToken) {
      res.status(401).json({ error: 'not authenticated' })
      return
    }
    const { rows: sessionRows } = await pool.query<{ user_id: number; current_workspace_id: number | null; expires_at: string }>(
      'SELECT user_id, current_workspace_id, expires_at FROM user_sessions WHERE id = $1',
      [hashToken(rawToken)],
    )
    const session = sessionRows[0]
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      clearSessionCookie(res)
      res.status(401).json({ error: 'session expired' })
      return
    }

    const { rows: userRows } = await pool.query<{ id: number; email: string; name: string; initials: string; color: string }>(
      'SELECT id, email, name, initials, color FROM users WHERE id = $1',
      [session.user_id],
    )
    const user = userRows[0]
    if (!user) {
      clearSessionCookie(res)
      res.status(401).json({ error: 'account no longer exists' })
      return
    }

    const workspaces = await getUserWorkspaces(user.id)
    const current = workspaces.find((w) => w.id === session.current_workspace_id) ?? workspaces[0] ?? null
    res.json({
      user: { id: user.id, email: user.email, name: user.name, initials: user.initials, color: user.color },
      currentWorkspace: current ? { id: current.id, name: current.name } : null,
      role: current?.role ?? null,
      workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
    })
  } catch (err) {
    handleAuthError(res, 'GET /api/auth/me', err)
  }
})

authRouter.post('/switch-workspace', async (req: Request, res: Response) => {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
    if (!rawToken) throw new MutationError(401, 'not authenticated')
    const { workspaceId } = req.body as { workspaceId?: number }
    if (!workspaceId) throw new MutationError(400, 'workspaceId is required')

    const { rows: sessionRows } = await pool.query<{ user_id: number }>(
      'SELECT user_id FROM user_sessions WHERE id = $1',
      [hashToken(rawToken)],
    )
    if (sessionRows.length === 0) throw new MutationError(401, 'session expired')

    const { rows: memberRows } = await pool.query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, sessionRows[0].user_id],
    )
    if (memberRows.length === 0) throw new MutationError(403, 'not a member of that workspace')

    await pool.query('UPDATE user_sessions SET current_workspace_id = $1 WHERE id = $2', [workspaceId, hashToken(rawToken)])
    res.status(200).json({ ok: true })
  } catch (err) {
    handleAuthError(res, 'POST /api/auth/switch-workspace', err)
  }
})
