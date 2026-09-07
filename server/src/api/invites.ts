// Invite management — creating/listing/revoking/resending invites is
// workspace-admin-only (enforced by callers via authMiddleware.requireAdmin);
// looking up an invite by its token and accepting it are the two operations
// a not-yet-a-member person needs, so those are exported separately for the
// public/lightly-protected routes in server.ts.
import { pool } from '../db.js'
import { generateToken, hashToken } from '../auth/tokens.js'
import { sendEmail } from '../auth/email.js'
import { MutationError } from './mutations.js'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = ['admin', 'member'] as const
type Role = (typeof VALID_ROLES)[number]

type InviteRow = {
  id: number
  email: string
  role: Role
  created_at: string
  expires_at: string
}

function shapeInvite(r: InviteRow) {
  return { id: String(r.id), email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at }
}

export async function getWorkspaceInvites(workspaceId: number) {
  const { rows } = await pool.query<InviteRow>(
    `SELECT id, email, role, created_at, expires_at FROM workspace_invites
     WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [workspaceId],
  )
  return rows.map(shapeInvite)
}

async function sendInviteEmail(email: string, workspaceName: string, rawToken: string) {
  const link = `${process.env.APP_BASE_URL ?? 'http://localhost:5173'}/accept-invite?token=${rawToken}`
  await sendEmail(
    email,
    `You're invited to join ${workspaceName} on Rotunda Board`,
    `<p>You've been invited to join <strong>${workspaceName}</strong> on Rotunda Board.</p>
     <p><a href="${link}">${link}</a></p>
     <p>This link expires in 7 days.</p>`,
  )
}

export async function createInvite(workspaceId: number, invitedBy: number, email: string, role: string) {
  if (!email?.trim() || !EMAIL_RE.test(email.trim())) throw new MutationError(400, 'a valid email is required')
  if (!VALID_ROLES.includes(role as Role)) throw new MutationError(400, `role must be one of ${VALID_ROLES.join(', ')}`)

  const { rows: workspaceRows } = await pool.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [
    workspaceId,
  ])
  const workspaceName = workspaceRows[0]?.name ?? 'the workspace'

  const rawToken = generateToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [workspaceId, email.trim().toLowerCase(), role, hashToken(rawToken), invitedBy, expiresAt],
  )

  await sendInviteEmail(email.trim(), workspaceName, rawToken)
  return { id: String(rows[0].id) }
}

async function requireOwnInvite(workspaceId: number, inviteId: number) {
  const { rows } = await pool.query<{ id: number; email: string }>(
    `SELECT id, email FROM workspace_invites
     WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [inviteId, workspaceId],
  )
  if (rows.length === 0) throw new MutationError(404, `invite ${inviteId} not found`)
  return rows[0]
}

export async function revokeInvite(workspaceId: number, inviteId: number) {
  await requireOwnInvite(workspaceId, inviteId)
  await pool.query('UPDATE workspace_invites SET revoked_at = now() WHERE id = $1', [inviteId])
}

export async function resendInvite(workspaceId: number, inviteId: number) {
  const invite = await requireOwnInvite(workspaceId, inviteId)
  const { rows: workspaceRows } = await pool.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [
    workspaceId,
  ])
  const workspaceName = workspaceRows[0]?.name ?? 'the workspace'

  const rawToken = generateToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  await pool.query('UPDATE workspace_invites SET token_hash = $1, expires_at = $2 WHERE id = $3', [
    hashToken(rawToken),
    expiresAt,
    inviteId,
  ])
  await sendInviteEmail(invite.email, workspaceName, rawToken)
}

// Public lookup for the accept-invite landing page — tells the frontend
// whether to render a login form (account already exists) or a signup form.
export async function getInviteByToken(rawToken: string) {
  const { rows } = await pool.query<{ email: string; role: Role; workspace_name: string }>(
    `SELECT wi.email, wi.role, w.name AS workspace_name
     FROM workspace_invites wi JOIN workspaces w ON w.id = wi.workspace_id
     WHERE wi.token_hash = $1 AND wi.accepted_at IS NULL AND wi.revoked_at IS NULL AND wi.expires_at > now()`,
    [hashToken(rawToken)],
  )
  const invite = rows[0]
  if (!invite) return null

  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE email = $1', [invite.email])
  return {
    workspaceName: invite.workspace_name,
    email: invite.email,
    role: invite.role,
    accountExists: userRows.length > 0,
  }
}

// For someone who's already logged in (with an existing account) accepting
// an invite — the fresh-account path goes through POST /api/auth/signup
// with inviteToken set instead, since it also has to create the user.
export async function acceptInviteForExistingUser(rawToken: string, userId: number) {
  const { rows } = await pool.query<{ id: number; workspace_id: number; role: Role; email: string }>(
    `SELECT id, workspace_id, role, email FROM workspace_invites
     WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(rawToken)],
  )
  const invite = rows[0]
  if (!invite) throw new MutationError(400, 'this invite is invalid or has expired')

  const { rows: userRows } = await pool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
  if (userRows[0]?.email !== invite.email) {
    throw new MutationError(403, 'this invite was sent to a different email address')
  }

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [invite.workspace_id, userId, invite.role],
  )
  await pool.query('UPDATE workspace_invites SET accepted_at = now() WHERE id = $1', [invite.id])
  return { workspaceId: invite.workspace_id }
}
