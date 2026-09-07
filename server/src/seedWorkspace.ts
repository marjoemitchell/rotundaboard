// Seeds one demo workspace: who's on the team (real accounts now, not
// display-only rows), and which real 2025-session bills they're tracking.
// This is NOT scraped — a real deployment collects it through the app
// itself (signup, invites). It exists here so the dashboard has something
// to render against real bill content during development. Destructively
// rebuilds the workspace layer every run (see the comment above the
// tracked-bills DELETE below for why) — safe to re-run, or run after a
// fresh `npm run scrape`.
import { pool } from './db.js'
import { hashPassword } from './auth/passwords.js'

const WORKSPACE_NAME = 'Montana Conservation Coalition'
const DEV_PASSWORD = 'password123' // dev-only — never reuse this anywhere real.

const TEAM_MEMBERS = [
  { email: 'casey@example.dev', name: 'Casey Whitford', initials: 'CW', color: '#2b7f8c', role: 'admin' as const },
  { email: 'mara@example.dev', name: 'Mara Reyes', initials: 'MR', color: '#b9723d', role: 'member' as const },
  { email: 'dana@example.dev', name: 'Dana Tibbets', initials: 'DT', color: '#4a5a6e', role: 'member' as const },
  { email: 'jules@example.dev', name: 'Jules Kanahele', initials: 'JK', color: '#7d5ba6', role: 'member' as const },
  { email: 'sam@example.dev', name: 'Sam Pruitt', initials: 'SP', color: '#3f6b8f', role: 'member' as const },
]

const POSITIONS = ['support', 'oppose', 'watch', 'neutral'] as const

async function main() {
  // workspaces.name isn't unique at the schema level (two real coalitions
  // could legitimately share a display name), so idempotency here is a
  // check-then-insert rather than ON CONFLICT.
  const { rows: existingWorkspace } = await pool.query<{ id: number }>('SELECT id FROM workspaces WHERE name = $1 LIMIT 1', [
    WORKSPACE_NAME,
  ])
  let workspaceId = existingWorkspace[0]?.id
  if (!workspaceId) {
    const { rows } = await pool.query<{ id: number }>('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [
      WORKSPACE_NAME,
    ])
    workspaceId = rows[0].id
  }
  console.log(`workspace "${WORKSPACE_NAME}" (id ${workspaceId})`)

  const passwordHash = await hashPassword(DEV_PASSWORD)
  const userIds: number[] = []
  for (const m of TEAM_MEMBERS) {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO users (email, name, initials, color, password_hash) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET name = $2, initials = $3, color = $4
       RETURNING id`,
      [m.email, m.name, m.initials, m.color, passwordHash],
    )
    const userId = rows[0].id
    userIds.push(userId)
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
      [workspaceId, userId, m.role],
    )
  }
  console.log(`seeded ${TEAM_MEMBERS.length} users into the workspace (dev password: "${DEV_PASSWORD}")`)
  for (const m of TEAM_MEMBERS) console.log(`  ${m.email} (${m.role})`)

  // One introduced bill per primary subject (preferring bills with more
  // cosponsors, so the seeded set has real vote/cosponsor/hearing detail to
  // show), plus a handful of pure LC-only drafts that never got a bill
  // number — this product is built around the interim/LC-draft experience,
  // so the tracked set needs to actually include some.
  const { rows: introduced } = await pool.query<{ bill_id: number }>(`
    SELECT DISTINCT ON (ds.subject_code_id) b.id AS bill_id
    FROM bills b
    JOIN drafts d ON d.id = b.draft_id
    JOIN draft_subjects ds ON ds.draft_id = d.id AND ds.is_primary = true
    LEFT JOIN (
      SELECT bill_id, count(*) AS n FROM bill_cosponsors GROUP BY bill_id
    ) cs ON cs.bill_id = b.id
    WHERE b.bill_number IS NOT NULL
    ORDER BY ds.subject_code_id, coalesce(cs.n, 0) DESC, b.id
    LIMIT 20
  `)
  const { rows: lcOnly } = await pool.query<{ bill_id: number }>(`
    SELECT DISTINCT ON (ds.subject_code_id) b.id AS bill_id
    FROM bills b
    JOIN drafts d ON d.id = b.draft_id
    JOIN draft_subjects ds ON ds.draft_id = d.id AND ds.is_primary = true
    LEFT JOIN (
      SELECT draft_id, count(*) AS n FROM bill_statuses GROUP BY draft_id
    ) st ON st.draft_id = d.id
    WHERE b.bill_number IS NULL
    ORDER BY ds.subject_code_id, coalesce(st.n, 0) DESC, b.id
    LIMIT 6
  `)
  const candidates = [...introduced, ...lcOnly]

  // Fully re-derive the tracked set each run rather than only upserting —
  // otherwise a bill that dropped out of this run's candidate selection
  // (e.g. after tuning the query) lingers in tracked_bills from a previous
  // run with no matching entry in memberById below, leaving its activity
  // log entry with a null actor.
  await pool.query('DELETE FROM tracked_bills WHERE workspace_id = $1', [workspaceId])

  const memberByBill = new Map<number, number>()
  for (const [index, bill] of candidates.entries()) {
    const assigneeId = userIds[index % userIds.length]
    const position = POSITIONS[index % POSITIONS.length]
    memberByBill.set(bill.bill_id, assigneeId)
    await pool.query(
      `INSERT INTO tracked_bills (workspace_id, bill_id, position, assignee_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, bill_id) DO UPDATE SET position = $3, assignee_id = $4`,
      [workspaceId, bill.bill_id, position, assigneeId],
    )
  }
  console.log(`tracked ${candidates.length} bills (one per subject, where available)`)

  const views = [
    { id: 'v-support', name: 'Coalition priority', color: '#2b7f8c', query: 'position:support' },
    { id: 'v-watch', name: 'Watching closely', color: '#b9723d', query: 'position:watch' },
    { id: 'v-oppose', name: 'Opposing', color: '#8f5426', query: 'position:oppose' },
  ]
  for (const v of views) {
    await pool.query(
      `INSERT INTO saved_views (id, workspace_id, name, color, query, created_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = $3, color = $4, query = $5`,
      [v.id, workspaceId, v.name, v.color, v.query, userIds[0]],
    )
  }
  console.log(`seeded ${views.length} saved views`)

  // Activity feed built from each tracked bill's own real, most recent
  // status-history entry — genuine events, not invented ones. The "actor" is
  // the bill's seeded assignee, and the verb is templated from the real
  // status name.
  await pool.query('DELETE FROM activity_log WHERE workspace_id = $1', [workspaceId])
  const { rows: latestStatuses } = await pool.query<{
    bill_id: number
    status_name: string
    occurred_at: string
  }>(
    `
    SELECT DISTINCT ON (b.id) b.id AS bill_id, bsc.name AS status_name, bs.occurred_at
    FROM tracked_bills tb
    JOIN bills b ON b.id = tb.bill_id
    JOIN bill_statuses bs ON bs.draft_id = b.draft_id
    JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
    WHERE tb.workspace_id = $1
    ORDER BY b.id, bs.occurred_at DESC
  `,
    [workspaceId],
  )
  for (const row of latestStatuses) {
    const actorId = memberByBill.get(row.bill_id)
    await pool.query(
      `INSERT INTO activity_log (workspace_id, actor_id, verb, detail, bill_id, occurred_at)
       VALUES ($1, $2, 'logged status', $3, $4, $5)`,
      [workspaceId, actorId, `Latest recorded action: ${row.status_name}`, row.bill_id, row.occurred_at],
    )
  }
  console.log(`seeded ${latestStatuses.length} activity log entries from real status history`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
