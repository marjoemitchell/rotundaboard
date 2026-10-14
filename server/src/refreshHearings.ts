// Refreshes the bill hearing schedule for the target session: which bills
// are on which standing committee agenda, and when. Meant to run each hour
// (cron-refresh-hearings), because hearing alerts must be fast. The full
// per-bill scrape (scrapeBillDetails.ts) runs once a day.
//
// The search endpoint returns every hearing in about 8 requests. A hearing
// on an upcoming meeting that is no longer in the results gets removed_at,
// and alerts.ts sends a cancellation for it.
import { pool } from './db.js'
import * as api from './legmtClient.js'
import { runAlertsAfterScrape } from './alerts.js'
import { withScrapeMonitoring } from './scrapeHealth.js'
import { upsertCommitteeMeeting } from './scrapeBillDetails.js'

const TARGET_SESSION_ORDINALS = process.env.SCRAPE_SESSION_ORDINALS ?? '20251'

async function main() {
  const { rows: committees } = await pool.query<{ id: number }>(
    `SELECT sc.id FROM standing_committees sc JOIN sessions s ON s.id = sc.session_id WHERE s.ordinals = $1`,
    [TARGET_SESSION_ORDINALS],
  )
  if (committees.length === 0) {
    throw new Error(`no standing committees for session ${TARGET_SESSION_ORDINALS}. Run "npm run scrape" first.`)
  }
  const { rows: billRows } = await pool.query<{ id: number }>(
    `SELECT b.id FROM bills b JOIN sessions s ON s.id = b.session_id WHERE s.ordinals = $1`,
    [TARGET_SESSION_ORDINALS],
  )
  const knownBills = new Set(billRows.map((b) => b.id))

  const seen: number[] = []
  let skipped = 0
  for await (const h of api.iterateBillHearings(committees.map((c) => c.id))) {
    // A bill that the daily scrape has not added yet. The next run gets it.
    if (!knownBills.has(h.billId)) {
      skipped += 1
      continue
    }
    await upsertCommitteeMeeting(h.committeeMeeting)
    await pool.query(
      `INSERT INTO committee_bill_hearings (id, bill_id, committee_meeting_id, status) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET bill_id = $2, committee_meeting_id = $3, status = $4, removed_at = NULL`,
      [h.id, h.billId, h.committeeMeeting.id, h.status ?? null],
    )
    seen.push(h.id)
  }

  // Upcoming hearings that the schedule no longer contains. Only hearings for
  // these committees, and only after a complete fetch (an error stops the run
  // before this point).
  const { rowCount: removed } = await pool.query(
    `UPDATE committee_bill_hearings h SET removed_at = now()
     FROM committee_meetings m
     WHERE m.id = h.committee_meeting_id
       AND m.standing_committee_id = ANY($1)
       AND m.meeting_time >= (now() AT TIME ZONE 'America/Denver')
       AND h.removed_at IS NULL
       AND NOT (h.id = ANY($2))`,
    [committees.map((c) => c.id), seen],
  )
  console.log(
    `refreshed ${seen.length} bill hearings for ${committees.length} committees` +
      `${skipped ? ` (${skipped} for bills not scraped yet)` : ''}, ${removed ?? 0} removed from the schedule.`,
  )
  await runAlertsAfterScrape()
}

withScrapeMonitoring('refresh-hearings', main)
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
