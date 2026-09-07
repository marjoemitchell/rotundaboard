// Refreshes interim-committee meeting records (times, locations, agendas)
// for every committee already in the database, without re-running the full
// scrape.ts (which also re-pulls every bill for the target session — slow,
// and unnecessary just to pick up newly-posted agendas). Meant to be run
// periodically; see server/README or ask for the current recommended
// cadence.
import { pool } from './db.js'
import { upsertNonStandingCommitteeMeetings } from './scrape.js'

async function main() {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM non_standing_committees')
  console.log(`refreshing meetings for ${rows.length} interim committees...`)
  await upsertNonStandingCommitteeMeetings(rows.map((r) => r.id))
  console.log('done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
