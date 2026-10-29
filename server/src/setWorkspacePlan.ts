// Sets the subscription plan of a workspace. Payments do not exist yet, so a
// maintainer changes plans with this script.
//
//   npm run set-plan                      list the workspaces and their plans
//   npm run set-plan -- <workspace> <plan>
//
// <workspace> is a workspace id or the exact workspace name.
// <plan> is one of the keys in plans.ts: free, single_user, team, organization.
import { pool } from './db.js'
import { PLAN_KEYS, setWorkspacePlan } from './plans.js'

async function main() {
  const [workspaceArg, planArg] = process.argv.slice(2)

  if (!workspaceArg) {
    const { rows } = await pool.query<{ id: number; name: string; plan: string; members: string }>(
      `SELECT w.id, w.name, w.plan, (SELECT count(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS members
       FROM workspaces w WHERE w.name NOT LIKE 'E2E %' ORDER BY w.id`,
    )
    for (const r of rows) console.log(`${String(r.id).padStart(5)}  ${r.plan.padEnd(13)} ${r.members} member(s)  ${r.name}`)
    return
  }
  if (!planArg) throw new Error(`Give a plan: ${PLAN_KEYS.join(', ')}`)

  const byId = /^\d+$/.test(workspaceArg)
  const { rows } = await pool.query<{ id: number; name: string }>(
    byId ? 'SELECT id, name FROM workspaces WHERE id = $1' : 'SELECT id, name FROM workspaces WHERE name = $1',
    [byId ? Number(workspaceArg) : workspaceArg],
  )
  if (rows.length === 0) throw new Error(`No workspace matches "${workspaceArg}".`)
  if (rows.length > 1) throw new Error(`${rows.length} workspaces have the name "${workspaceArg}". Use the id.`)

  const plan = await setWorkspacePlan(rows[0].id, planArg)
  console.log(`${rows[0].name} (id ${rows[0].id}) now has the ${plan.label} plan.`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
