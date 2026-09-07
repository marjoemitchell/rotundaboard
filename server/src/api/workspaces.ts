// Workspace-level admin actions: renaming/deleting the workspace itself and
// managing its members' roles. All of this is restricted to admins by the
// callers in server.ts (via authMiddleware.requireAdmin) — this module just
// holds the guards that don't fit that one-liner, like "don't let the last
// admin get demoted or removed."
import { pool } from '../db.js'
import { MutationError } from './mutations.js'

const VALID_ROLES = ['admin', 'member'] as const
type Role = (typeof VALID_ROLES)[number]

type MemberRow = { id: number; name: string; email: string; initials: string; color: string; role: Role }

export async function getDetailedMembers(workspaceId: number) {
  const { rows } = await pool.query<MemberRow>(
    `SELECT u.id, u.name, u.email, u.initials, u.color, wm.role
     FROM workspace_members wm JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.role, u.name`,
    [workspaceId],
  )
  return rows.map((r) => ({ id: String(r.id), name: r.name, email: r.email, initials: r.initials, color: r.color, role: r.role }))
}

export async function renameWorkspace(workspaceId: number, name: string) {
  const trimmed = name?.trim()
  if (!trimmed) throw new MutationError(400, 'name is required')
  await pool.query('UPDATE workspaces SET name = $1 WHERE id = $2', [trimmed, workspaceId])
  return { name: trimmed }
}

async function requireMembership(workspaceId: number, userId: number) {
  const { rows } = await pool.query<{ role: Role }>(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  )
  if (rows.length === 0) throw new MutationError(404, `user ${userId} is not a member of this workspace`)
  return rows[0]
}

async function requireAnotherAdminExists(workspaceId: number, excludingUserId: number, action: string) {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM workspace_members WHERE workspace_id = $1 AND role = 'admin' AND user_id != $2`,
    [workspaceId, excludingUserId],
  )
  if (Number(rows[0].n) === 0) throw new MutationError(400, `cannot ${action} the last admin`)
}

export async function updateMemberRole(workspaceId: number, targetUserId: number, role: string) {
  if (!VALID_ROLES.includes(role as Role)) throw new MutationError(400, `role must be one of ${VALID_ROLES.join(', ')}`)
  const current = await requireMembership(workspaceId, targetUserId)
  if (current.role === role) return { role }

  if (current.role === 'admin' && role === 'member') {
    await requireAnotherAdminExists(workspaceId, targetUserId, 'demote')
  }
  await pool.query('UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3', [
    role,
    workspaceId,
    targetUserId,
  ])
  return { role }
}

// Moves any session currently "in" this workspace to another workspace the
// same user belongs to (or to none, if they have none) — user_sessions has
// no ON DELETE clause on current_workspace_id, so a dangling reference
// there would otherwise 401 every subsequent request for that session.
async function relocateSessions(client: { query: typeof pool.query }, workspaceId: number, userId: number) {
  const { rows: otherMemberships } = await client.query<{ workspace_id: number }>(
    'SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND workspace_id != $2 ORDER BY workspace_id LIMIT 1',
    [userId, workspaceId],
  )
  const nextWorkspaceId = otherMemberships[0]?.workspace_id ?? null
  await client.query('UPDATE user_sessions SET current_workspace_id = $1 WHERE user_id = $2 AND current_workspace_id = $3', [
    nextWorkspaceId,
    userId,
    workspaceId,
  ])
  return nextWorkspaceId
}

export async function removeMember(workspaceId: number, targetUserId: number, requestingUserId: number) {
  if (targetUserId === requestingUserId) {
    throw new MutationError(400, "you can't remove yourself from the workspace")
  }
  const target = await requireMembership(workspaceId, targetUserId)
  if (target.role === 'admin') {
    await requireAnotherAdminExists(workspaceId, targetUserId, 'remove')
  }

  // Removing membership doesn't erase the person's history — notes,
  // testimony, etc. still attribute to their user row (see migration 015),
  // same as if they'd left on their own.
  await pool.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, targetUserId])
  await relocateSessions(pool, workspaceId, targetUserId)
}

const WORKSPACE_SCOPED_TABLES = [
  'tags',
  'tracked_bills',
  'notes',
  'activity_log',
  'subject_watches',
  'followed_committees',
  'testimony',
  'digests',
  'saved_views',
]

export async function deleteWorkspace(workspaceId: number, requestingUserId: number): Promise<{ nextWorkspaceId: number | null }> {
  const { rows: members } = await pool.query<{ user_id: number }>(
    'SELECT user_id FROM workspace_members WHERE workspace_id = $1',
    [workspaceId],
  )

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const member of members) {
      await relocateSessions(client, workspaceId, member.user_id)
    }
    for (const table of WORKSPACE_SCOPED_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId])
    }
    // workspace_members and workspace_invites cascade off this automatically.
    await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const { rows: remaining } = await pool.query<{ workspace_id: number }>(
    'SELECT workspace_id FROM workspace_members WHERE user_id = $1 ORDER BY workspace_id LIMIT 1',
    [requestingUserId],
  )
  return { nextWorkspaceId: remaining[0]?.workspace_id ?? null }
}
