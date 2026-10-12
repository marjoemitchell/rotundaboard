// Daily cron: sends everyone on 'daily' delivery the alerts queued since
// their last digest (and catches up anything left for 'immediate' people,
// e.g. if a scrape's own alert step failed). Detection runs here too, so a
// change picked up between scrapes isn't held for another day.
import { pool } from './db.js'
import { processAlerts } from './alerts.js'

async function main() {
  const result = await processAlerts({ digest: true })
  if (!result) {
    console.log('another alert run is in progress; exiting.')
    return
  }
  console.log(
    result.baseline
      ? 'first run — recorded the current state as a baseline; no alerts sent.'
      : `${result.newEvents} new change(s), ${result.queued} alert(s) queued, ${result.alerts} alert(s) sent in ${result.emails} email(s).`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
