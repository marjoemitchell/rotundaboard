// Sweeps up everything the Playwright e2e suite creates. Every fixture-made
// workspace is named "E2E ..." and every fixture-made user's email starts
// with "e2e-" (see e2e/fixtures.ts) specifically so this cleanup can find
// them by pattern without touching real seeded data. Run automatically as
// Playwright's globalTeardown; safe to run manually too (e.g. after a run
// that got killed mid-test and left rows behind).
import { pool } from './db.js'

const WORKSPACE_NAME_PATTERN = 'E2E %'
const USER_EMAIL_PATTERN = 'e2e-%@example.dev'

// workspace_id columns on these tables have no ON DELETE CASCADE, so they
// must be cleared before the workspace row itself can be deleted.
// workspace_members and workspace_invites do cascade off workspaces(id).
const WORKSPACE_SCOPED_TABLES = [
  'tags',
  'tracked_bills',
  'notes',
  'activity_log',
  'subject_watches',
  'followed_committees',
  'testimony',
  'saved_views',
]

async function main() {
  const { rows: workspaces } = await pool.query<{ id: number }>('SELECT id FROM workspaces WHERE name LIKE $1', [
    WORKSPACE_NAME_PATTERN,
  ])
  const { rows: users } = await pool.query<{ id: number }>('SELECT id FROM users WHERE email LIKE $1', [
    USER_EMAIL_PATTERN,
  ])
  const workspaceIds = workspaces.map((w) => w.id)
  const userIds = users.map((u) => u.id)

  if (workspaceIds.length > 0) {
    for (const table of WORKSPACE_SCOPED_TABLES) {
      await pool.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1)`, [workspaceIds])
    }
  }

  // user_sessions.current_workspace_id and workspace_invites.invited_by both
  // reference users/workspaces with no ON DELETE clause, so any session tied
  // to an e2e user or workspace has to go before either parent row can be
  // deleted. workspace_members and workspace_invites *do* cascade off
  // workspaces(id), so deleting the workspace below clears those for free.
  if (userIds.length > 0 || workspaceIds.length > 0) {
    await pool.query('DELETE FROM user_sessions WHERE user_id = ANY($1) OR current_workspace_id = ANY($2)', [
      userIds,
      workspaceIds,
    ])
  }

  if (workspaceIds.length > 0) {
    await pool.query('DELETE FROM workspaces WHERE id = ANY($1)', [workspaceIds])
  }

  const { rowCount: deletedUsers } = await pool.query('DELETE FROM users WHERE email LIKE $1', [USER_EMAIL_PATTERN])

  console.log(`e2e cleanup: removed ${workspaceIds.length} workspace(s) and ${deletedUsers ?? 0} user(s)`)
  await pool.end()
}

main().catch((err) => {
  console.error('e2e cleanup failed:', err)
  process.exit(1)
})
