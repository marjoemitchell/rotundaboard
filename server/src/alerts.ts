// Change alerts: email workspace members when something they track, watch,
// or follow changes. Runs at the end of every scrape (scrape.ts,
// scrapeBillDetails.ts, refreshCommitteeMeetings.ts) and once a day for
// digests (sendAlertDigest.ts).
//
//   1. Detect — record every alertable row as a change_events row keyed by
//      the Legislature's own ids. A key that already exists is skipped, so
//      the same change can't become two events. The first run ever records
//      everything as `baseline` and alerts no one.
//   2. Match — each new event to workspaces: tracked bills, subject watches
//      (same subject/tag rule as the Watches page), followed committees.
//   3. Queue — one alert_deliveries row per member, minus members whose
//      delivery is 'off' or who muted every source that matched. The
//      primary key makes queueing idempotent.
//   4. Send — each person's unsent alerts as one email: right away for
//      'immediate', or batched by the daily digest for 'daily'.
import { pool } from './db.js'
import { sendLayoutEmail } from './auth/email.js'
import { appBaseUrl, escapeHtml, type EmailContent } from './emailLayout.js'

const ADVISORY_LOCK_KEY = 7_340_020
// Hearings and meetings only matter while they're upcoming; a row first
// seen (or moved) well after the fact isn't worth an email.
const SCHEDULE_LOOKBACK = "interval '1 day'"
// Scraped meeting times are naive Montana wall-clock times (see db.ts), so
// compare them with the current Montana time, not with now().
const NOW_MT = "(now() AT TIME ZONE 'America/Denver')"
// A status that is older than this is history, not news (see detectChanges).
const OLD_STATUS_DAYS = 7
// A hearing is active when neither the meeting nor the bill's place on its
// agenda is canceled, and the hearing is still in the schedule.
const HEARING_ACTIVE =
  "(coalesce(cm.status, '') <> 'CANCELED' AND coalesce(cbh.status, '') <> 'CANCELED' AND cbh.removed_at IS NULL)"
// The lead times that a person can choose for hearing reminders, in hours
// before the hearing. Sorted from the shortest to the longest.
export const REMINDER_LEAD_HOURS = [2, 24, 48] as const
// The hearing schedule refreshes one time each hour, so a reminder can be up
// to this many hours earlier than its lead time.
const REMINDER_SLACK_HOURS = 1
const REMINDER_MIN_NOTICE_HOURS = 6
// The maximum time that an amendment alert waits for the amendment summary.
const AMENDMENT_SUMMARY_WAIT_HOURS = 12

export type DeliveryMode = 'immediate' | 'daily' | 'off'
export const DEFAULT_DELIVERY: DeliveryMode = 'immediate'

// ---------------------------------------------------------------- detect

async function detectChanges(): Promise<{ newEventIds: number[]; baseline: boolean }> {
  const { rows: existing } = await pool.query<{ any: boolean }>('SELECT EXISTS (SELECT 1 FROM change_events) AS any')
  const baseline = !existing[0].any

  const statements = [
    // A new status row: introduced, referred, heard, passed, signed, ...
    // A status older than ${OLD_STATUS_DAYS} days is a silent baseline event:
    // the first scrape of a new session stores the full history of each
    // draft, and that history is not news.
    `INSERT INTO change_events (key, kind, bill_id, summary, occurred_at, baseline)
     SELECT 'status:' || bs.id, 'bill_status', b.id, coalesce(bsc.name, 'Status updated'), bs.occurred_at,
            $1 OR bs.occurred_at < ${NOW_MT} - interval '${OLD_STATUS_DAYS} days'
     FROM bill_statuses bs
     JOIN bills b ON b.draft_id = bs.draft_id
     LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
     -- Only rows without an event. An index lookup for each row is much
     -- faster than an insert attempt for each of the ~66,000 statuses.
     WHERE NOT EXISTS (SELECT 1 FROM change_events e WHERE e.key = 'status:' || bs.id)
     ON CONFLICT (key) DO NOTHING
     RETURNING id, baseline`,
    // An amendment alert waits for the amendment summary
    // (refreshBillTexts.ts), so that the email can tell what the amendment
    // does. It waits a maximum of ${AMENDMENT_SUMMARY_WAIT_HOURS} hours.
    `INSERT INTO change_events (key, kind, bill_id, summary, detail, baseline)
     SELECT 'amendment:' || a.id, 'amendment', a.bill_id,
            'New amendment' || coalesce(' #' || a.number::text, ''),
            coalesce(ad.summary,
              nullif(concat_ws(' · ', a.type, CASE WHEN a.bill_version IS NOT NULL THEN 'to version ' || a.bill_version END), '')),
            $1
     FROM amendments a
     LEFT JOIN LATERAL (
       SELECT summary FROM amendment_documents ad
       WHERE ad.amendment_id = a.id AND ad.summary IS NOT NULL
       ORDER BY ad.posted_at DESC NULLS LAST LIMIT 1
     ) ad ON true
     WHERE a.bill_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM change_events e WHERE e.key = 'amendment:' || a.id)
       AND ($1 OR ad.summary IS NOT NULL
            OR a.first_seen_at < now() - interval '${AMENDMENT_SUMMARY_WAIT_HOURS} hours')
     ON CONFLICT (key) DO NOTHING
     RETURNING id`,
    // Keyed by meeting time too, so a hearing that moves is a new event
    // ("rescheduled") rather than silently updating. Canceled hearings and
    // meetings are not "scheduled".
    `INSERT INTO change_events (key, kind, variant, bill_id, summary, detail, occurred_at, baseline)
     SELECT 'hearing:' || cbh.id || ':' || cm.meeting_time, 'bill_hearing',
            CASE WHEN EXISTS (SELECT 1 FROM change_events e WHERE e.ref = 'hearing:' || cbh.id)
                 THEN 'rescheduled' ELSE 'scheduled' END,
            cbh.bill_id,
            CASE WHEN EXISTS (SELECT 1 FROM change_events e WHERE e.ref = 'hearing:' || cbh.id)
                 THEN 'Hearing moved' ELSE 'Hearing scheduled' END
              || coalesce(': ' || sc.name, ''),
            cm.location, cm.meeting_time, $1
     FROM committee_bill_hearings cbh
     JOIN committee_meetings cm ON cm.id = cbh.committee_meeting_id
     LEFT JOIN standing_committees sc ON sc.id = cm.standing_committee_id
     WHERE cm.meeting_time >= ${NOW_MT} - ${SCHEDULE_LOOKBACK}
       AND ${HEARING_ACTIVE}
     ON CONFLICT (key) DO NOTHING
     RETURNING id`,
    // A cancellation, only for a hearing that people were told about, and
    // only one time for each announcement. The time can change together with
    // the cancellation, so look for an announcement at any time.
    `INSERT INTO change_events (key, kind, variant, bill_id, summary, detail, occurred_at, baseline)
     SELECT 'hearing-canceled:' || cbh.id || ':' || cm.meeting_time, 'bill_hearing', 'canceled', cbh.bill_id,
            'Hearing canceled' || coalesce(': ' || sc.name, ''), cm.location, cm.meeting_time, $1
     FROM committee_bill_hearings cbh
     JOIN committee_meetings cm ON cm.id = cbh.committee_meeting_id
     LEFT JOIN standing_committees sc ON sc.id = cm.standing_committee_id
     WHERE cm.meeting_time >= ${NOW_MT} - ${SCHEDULE_LOOKBACK}
       AND NOT ${HEARING_ACTIVE}
       AND EXISTS (
         SELECT 1 FROM change_events e
         WHERE e.ref = 'hearing:' || cbh.id
           AND NOT EXISTS (
             SELECT 1 FROM change_events c
             WHERE c.ref = 'hearing-canceled:' || cbh.id AND c.detected_at >= e.detected_at
           )
       )
     ON CONFLICT (key) DO NOTHING
     RETURNING id`,
    ...REMINDER_LEAD_HOURS.map(reminderStatement),
    `INSERT INTO change_events (key, kind, variant, committee_id, summary, detail, occurred_at, baseline)
     SELECT 'meeting:' || m.id || ':' || m.meeting_time, 'committee_meeting',
            CASE WHEN EXISTS (SELECT 1 FROM change_events e WHERE e.ref = 'meeting:' || m.id)
                 THEN 'rescheduled' ELSE 'scheduled' END,
            m.non_standing_committee_id,
            CASE WHEN EXISTS (SELECT 1 FROM change_events e WHERE e.ref = 'meeting:' || m.id)
                 THEN 'Meeting moved' ELSE 'Meeting scheduled' END,
            m.location, m.meeting_time, $1
     FROM non_standing_committee_meetings m
     WHERE m.meeting_time >= ${NOW_MT} - ${SCHEDULE_LOOKBACK} AND m.non_standing_committee_id IS NOT NULL
       AND coalesce(m.status, '') <> 'CANCELED'
     ON CONFLICT (key) DO NOTHING
     RETURNING id`,
    `INSERT INTO change_events (key, kind, variant, committee_id, summary, detail, occurred_at, baseline)
     SELECT 'meeting-canceled:' || m.id || ':' || m.meeting_time, 'committee_meeting', 'canceled',
            m.non_standing_committee_id, 'Meeting canceled', m.location, m.meeting_time, $1
     FROM non_standing_committee_meetings m
     WHERE m.meeting_time >= ${NOW_MT} - ${SCHEDULE_LOOKBACK}
       AND m.status = 'CANCELED'
       AND EXISTS (
         SELECT 1 FROM change_events e
         WHERE e.ref = 'meeting:' || m.id
           AND NOT EXISTS (
             SELECT 1 FROM change_events c
             WHERE c.ref = 'meeting-canceled:' || m.id AND c.detected_at >= e.detected_at
           )
       )
     ON CONFLICT (key) DO NOTHING
     RETURNING id`,
  ]

  const newEventIds: number[] = []
  for (const sql of statements) {
    const { rows } = await pool.query<{ id: number; baseline?: boolean }>(sql, [baseline])
    if (!baseline) newEventIds.push(...rows.filter((r) => !r.baseline).map((r) => r.id))
  }
  return { newEventIds, baseline }
}

// The statement that records the reminders for one lead time. The windows
// of the lead times do not overlap, so one run records a maximum of one
// reminder for each hearing. The statement skips the reminder in these
// conditions:
//
//   - The announcement of the hearing came after the time of the reminder.
//     The announcement email then gives the same information.
//   - The announcement came less than REMINDER_MIN_NOTICE_HOURS ago. The
//     person read about the hearing recently.
function reminderStatement(hours: number, index: number): string {
  const after = index === 0 ? 0 : REMINDER_LEAD_HOURS[index - 1] + REMINDER_SLACK_HOURS
  const until = hours + REMINDER_SLACK_HOURS
  return `INSERT INTO change_events (key, kind, variant, reminder_hours, bill_id, summary, detail, occurred_at, baseline)
     SELECT 'hearing-reminder:' || cbh.id || ':' || cm.meeting_time || ':${hours}h', 'bill_hearing', 'reminder', ${hours},
            cbh.bill_id, 'Hearing reminder' || coalesce(': ' || sc.name, ''), cm.location, cm.meeting_time, $1
     FROM committee_bill_hearings cbh
     JOIN committee_meetings cm ON cm.id = cbh.committee_meeting_id
     LEFT JOIN standing_committees sc ON sc.id = cm.standing_committee_id
     WHERE cm.meeting_time > ${NOW_MT} + interval '${after} hours'
       AND cm.meeting_time <= ${NOW_MT} + interval '${until} hours'
       AND ${HEARING_ACTIVE}
       AND EXISTS (
         SELECT 1 FROM change_events e
         WHERE e.key = 'hearing:' || cbh.id || ':' || cm.meeting_time
           AND e.detected_at < now() - interval '${REMINDER_MIN_NOTICE_HOURS} hours'
           AND e.detected_at < (cm.meeting_time - interval '${hours} hours') AT TIME ZONE 'America/Denver'
       )
     ON CONFLICT (key) DO NOTHING
     RETURNING id`
}

// ---------------------------------------------------------------- match + queue

async function queueDeliveries(eventIds: number[]): Promise<number> {
  if (eventIds.length === 0) return 0
  const { rowCount } = await pool.query(
    `WITH ev AS (SELECT * FROM change_events WHERE id = ANY($1)),
     matches AS (
       SELECT ev.id AS event_id, tb.workspace_id, 'tracked_bills' AS watch_type, 0 AS watch_id, 'Tracked bill' AS reason
       FROM ev JOIN tracked_bills tb ON tb.bill_id = ev.bill_id
       UNION ALL
       SELECT ev.id, w.workspace_id, 'subject_watch', w.id, 'Watch: ' || w.name
       FROM ev
       JOIN bills b ON b.id = ev.bill_id
       JOIN subject_watches w ON
         EXISTS (
           SELECT 1 FROM draft_subjects ds JOIN subject_codes sc ON sc.id = ds.subject_code_id
           WHERE ds.draft_id = b.draft_id AND sc.code = ANY(w.subject_codes)
         )
         OR EXISTS (SELECT 1 FROM bill_tags bt WHERE bt.bill_id = b.id AND bt.tag_id = ANY(w.tag_ids))
       UNION ALL
       SELECT ev.id, fc.workspace_id, 'followed_committee', fc.committee_id, 'Followed committee'
       FROM ev JOIN followed_committees fc ON fc.committee_id = ev.committee_id
     )
     INSERT INTO alert_deliveries (user_id, workspace_id, event_id, reasons)
     SELECT wm.user_id, m.workspace_id, m.event_id, array_agg(DISTINCT m.reason ORDER BY m.reason)
     FROM matches m
     JOIN change_events ce ON ce.id = m.event_id
     JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
     LEFT JOIN notification_preferences np ON np.user_id = wm.user_id
     WHERE coalesce(np.delivery, $2) <> 'off'
       AND (ce.variant IS DISTINCT FROM 'reminder' OR ce.reminder_hours = ANY(coalesce(np.hearing_reminder_hours, '{24}')))
       AND NOT EXISTS (
         SELECT 1 FROM alert_mutes am
         WHERE am.user_id = wm.user_id AND am.workspace_id = m.workspace_id
           AND am.watch_type = m.watch_type AND am.watch_id = m.watch_id
       )
     GROUP BY wm.user_id, m.workspace_id, m.event_id
     ON CONFLICT DO NOTHING`,
    [eventIds, DEFAULT_DELIVERY],
  )
  return rowCount ?? 0
}

// ---------------------------------------------------------------- send

interface PendingAlert {
  user_id: number
  email: string
  user_name: string
  workspace_id: number
  workspace_name: string
  event_id: number
  reasons: string[]
  kind: string
  variant: string | null
  bill_id: number | null
  committee_id: number | null
  summary: string
  detail: string | null
  occurred_at: string | null
  bill_label: string | null
  bill_title: string | null
  committee_name: string | null
}

// occurred_at is a naive Mountain wall-clock string; format its digits
// as-is rather than letting the server's timezone shift them.
function formatWhen(naive: string | null, withTime: boolean): string | null {
  if (!naive) return null
  const date = new Date(`${naive.replace(' ', 'T').slice(0, 19)}Z`)
  if (Number.isNaN(date.getTime())) return null
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }
  if (withTime) Object.assign(opts, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return date.toLocaleString('en-US', opts)
}

const HEARING_SUBJECTS: Record<string, string> = {
  scheduled: 'Hearing scheduled',
  rescheduled: 'Hearing moved',
  canceled: 'Hearing canceled',
  reminder: 'Hearing reminder',
}

function renderEmail(alerts: PendingAlert[], digest: boolean): { subject: string; content: EmailContent } {
  const base = appBaseUrl()
  const count = alerts.length
  const onlyHearing = count === 1 && alerts[0].kind === 'bill_hearing' && alerts[0].variant ? alerts[0] : null
  const hearingSubject = onlyHearing
    ? `${HEARING_SUBJECTS[onlyHearing.variant!] ?? 'Hearing update'}: ${onlyHearing.bill_label ?? 'a bill you follow'}, ${formatWhen(onlyHearing.occurred_at, true) ?? ''}`
    : null
  const subject = hearingSubject ?? (digest
    ? `Your Rotunda Board digest: ${count} update${count === 1 ? '' : 's'}`
    : `Rotunda Board: ${count} update${count === 1 ? '' : 's'} on bills and committees you follow`)

  const byWorkspace = new Map<number, PendingAlert[]>()
  for (const a of alerts) byWorkspace.set(a.workspace_id, [...(byWorkspace.get(a.workspace_id) ?? []), a])

  const sections = [...byWorkspace.values()].map((items) => {
    // Group a workspace's alerts under the bill or committee they're about.
    const groups = new Map<string, PendingAlert[]>()
    for (const a of items) {
      const key = a.bill_id != null ? `bill:${a.bill_id}` : `committee:${a.committee_id}`
      groups.set(key, [...(groups.get(key) ?? []), a])
    }
    const blocks = [...groups.values()].map((group) => {
      const first = group[0]
      const heading =
        first.bill_id != null
          ? `<a href="${base}/bills/${first.bill_id}" style="color:#0f2547;"><b>${escapeHtml(first.bill_label ?? 'Bill')}</b></a>${first.bill_title ? `: ${escapeHtml(first.bill_title)}` : ''}`
          : `<a href="${base}/committees/${first.committee_id}" style="color:#0f2547;"><b>${escapeHtml(first.committee_name ?? 'Committee')}</b></a>`
      const lines = group
        .map((a) => {
          const when = formatWhen(a.occurred_at, a.kind === 'bill_hearing' || a.kind === 'committee_meeting')
          const hearing = a.kind === 'bill_hearing'
          const summary = hearing ? `<b>${escapeHtml(a.summary)}</b>` : escapeHtml(a.summary)
          // The detail of an amendment is its summary: show it on its own line.
          const amendment = a.kind === 'amendment'
          const parts = [summary, when ? escapeHtml(when) : null, a.detail && !amendment ? escapeHtml(a.detail) : null].filter(Boolean)
          const below =
            amendment && a.detail ? `<div style="margin:2px 0 0;color:#5c6b80;">${escapeHtml(a.detail)}</div>` : ''
          // A link to the bill's testimony form, while there is still time to use it.
          const testimony =
            hearing && a.variant !== 'canceled' && a.bill_id != null
              ? ` · <a href="${base}/bills/${a.bill_id}#testimony" style="color:#2b7f8c;">Prepare testimony</a>`
              : ''
          return `<li style="margin:0 0 4px;">${parts.join(' · ')}${testimony}${below}</li>`
        })
        .join('')
      const reasons = [...new Set(group.flatMap((a) => a.reasons))]
      return `<div style="margin:0 0 14px">${heading}<div style="color:#8697ab;font-size:12px">${escapeHtml(reasons.join(' · '))}</div><ul style="margin:4px 0 0;padding-left:18px">${lines}</ul></div>`
    })
    return `<p style="margin:18px 0 8px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#5c6b80;">${escapeHtml(items[0].workspace_name)}</p>${blocks.join('')}`
  })

  const content: EmailContent = {
    heading: onlyHearing
      ? `${HEARING_SUBJECTS[onlyHearing.variant!] ?? 'Hearing update'}: ${onlyHearing.bill_label ?? 'a bill you follow'}`
      : digest
        ? 'Your daily digest'
        : `${count} update${count === 1 ? '' : 's'} for you`,
    preheader: `${count} change${count === 1 ? '' : 's'} on bills and committees that you follow.`,
    bodyHtml: `<p style="margin:0;">Hi ${escapeHtml(alerts[0].user_name)}, these changed${digest ? ' since your last digest' : ''}:</p>
${sections.join('')}`,
    button: { label: 'Open Rotunda Board', url: base },
    footerHtml: `You get these emails because of your tracked bills, subject watches, and followed committees.
<a href="${base}/settings" style="color:#2b7f8c;">Change alert settings</a>`,
  }
  return { subject, content }
}

// Hearing alerts are time-sensitive (people must arrange testimony), so they
// go out right away, also for people who chose the daily digest.
const URGENT_KINDS = ['bill_hearing']

async function sendPending(mode: 'immediate' | 'daily'): Promise<{ emails: number; alerts: number }> {
  // Claim first (sent_at set in the same statement that selects), so a
  // concurrent or repeated run can't send the same alert twice.
  const { rows } = await pool.query<PendingAlert>(
    `WITH claimed AS (
       UPDATE alert_deliveries d SET sent_at = now()
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id, change_events ev
       WHERE d.user_id = u.id AND ev.id = d.event_id AND d.sent_at IS NULL
         AND (
           coalesce(np.delivery, $2) = $1
           OR ($1 = 'immediate' AND coalesce(np.delivery, $2) = 'daily' AND ev.kind = ANY($3))
         )
       RETURNING d.user_id, d.workspace_id, d.event_id, d.reasons
     )
     SELECT c.user_id, u.email, u.name AS user_name, c.workspace_id, w.name AS workspace_name,
            c.event_id, c.reasons, e.kind, e.variant, e.bill_id, e.committee_id, e.summary, e.detail, e.occurred_at,
            CASE WHEN bt.code IS NOT NULL AND b.bill_number IS NOT NULL THEN bt.code || ' ' || b.bill_number
                 ELSE regexp_replace(dr.draft_number, '^([A-Za-z]+)(\\d+)$', '\\1 \\2') END AS bill_label,
            dr.short_title AS bill_title, nsc.name AS committee_name
     FROM claimed c
     JOIN users u ON u.id = c.user_id
     JOIN workspaces w ON w.id = c.workspace_id
     JOIN change_events e ON e.id = c.event_id
     LEFT JOIN bills b ON b.id = e.bill_id
     LEFT JOIN drafts dr ON dr.id = b.draft_id
     LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
     LEFT JOIN non_standing_committees nsc ON nsc.id = e.committee_id
     ORDER BY c.user_id, w.name, e.bill_id NULLS LAST, e.committee_id, e.occurred_at NULLS LAST, e.id`,
    [mode, DEFAULT_DELIVERY, URGENT_KINDS],
  )

  const byUser = new Map<number, PendingAlert[]>()
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r])
  for (const alerts of byUser.values()) {
    const { subject, content } = renderEmail(alerts, mode === 'daily')
    await sendLayoutEmail(alerts[0].email, subject, content)
  }
  return { emails: byUser.size, alerts: rows.length }
}

// ---------------------------------------------------------------- entry points

export interface AlertRunResult {
  baseline: boolean
  newEvents: number
  queued: number
  emails: number
  alerts: number
}

/**
 * Detect, queue, and send. `digest: true` also sends everyone on daily
 * delivery (the daily cron); otherwise only 'immediate' people get mail.
 * Serialized with a Postgres advisory lock, since three scrape crons call it.
 */
export async function processAlerts(opts: { digest?: boolean; waitForLock?: boolean } = {}): Promise<AlertRunResult | null> {
  const client = await pool.connect()
  try {
    // waitForLock: wait for a run that is in progress, then run. The e2e
    // test route uses it, so that a test's change is always processed.
    if (opts.waitForLock) {
      await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY])
    } else {
      const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY])
      if (!rows[0].ok) return null
    }
    try {
      const { newEventIds, baseline } = await detectChanges()
      const queued = await queueDeliveries(newEventIds)
      const immediate = await sendPending('immediate')
      const daily = opts.digest ? await sendPending('daily') : { emails: 0, alerts: 0 }
      return {
        baseline,
        newEvents: newEventIds.length,
        queued,
        emails: immediate.emails + daily.emails,
        alerts: immediate.alerts + daily.alerts,
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

/** For the scrape scripts: run alerts after a successful scrape, logging rather than failing it. */
export async function runAlertsAfterScrape(): Promise<void> {
  try {
    const result = await processAlerts()
    if (!result) {
      console.log('alerts: another alert run is in progress; skipping.')
    } else if (result.baseline) {
      console.log('alerts: first run — recorded the current state as a baseline; no alerts sent.')
    } else {
      console.log(
        `alerts: ${result.newEvents} new change(s), ${result.queued} alert(s) queued, ${result.emails} email(s) sent.`,
      )
    }
  } catch (err) {
    console.error('alerts failed:', err)
    process.exitCode = 1
  }
}
