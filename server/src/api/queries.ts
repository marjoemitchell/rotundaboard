// Fetches + shapes data for the frontend's Bill/SessionCalendar/etc. types
// (see rotundaboard/src/types.ts). Kept in one file since the mapping from
// our normalized schema to the app's view-model shapes is the whole point
// of this module — splitting it up would just add indirection.
//
// Functions here fall into two groups: pure legislative-reference reads
// (bills, legislators, committees, sessions, subject codes — scraped from
// bills.legmt.gov/committees.legmt.gov, identical for every workspace) take
// no workspaceId. Everything touching a workspace-owned table (tracked_bills,
// notes, tags, subject_watches, followed_committees, testimony, digests,
// saved_views, activity_log) takes a workspaceId and scopes its query by it —
// without that, a valid session in one workspace could read a row belonging
// to another just by knowing its numeric id.
import { readFileSync } from 'node:fs'
import { pool } from '../db.js'
import { versionLabel, versionOrder } from '../billText.js'
import type { HearingAiSummary } from '../summarizeHearings.js'
import { computeMomentum, determineOutcome, isProgressStopped, type StatusPoint } from '../momentum.js'
import { FULL_TRANSCRIPT_DAYS, windowStart } from '../recordingWindows.js'

function formatIdentifier(billTypeCode: string | null, billNumber: number | null, draftNumber: string): string {
  if (billTypeCode && billNumber != null) return `${billTypeCode} ${billNumber}`
  // "LC0412" -> "LC 0412"
  const match = draftNumber.match(/^([A-Za-z]+)(\d+)$/)
  return match ? `${match[1]} ${match[2]}` : draftNumber
}

// bills.legmt.gov's own SPA is hash-routed and keys a bill by legislature id
// + its LC draft number, not by bill type/number or our own bill id — this
// works for a bill at any stage (confirmed against both an enacted law and
// one that died in committee), so it's the one link that always resolves.
function buildOfficialBillUrl(legislatureId: number | null, draftNumber: string): string | null {
  if (!legislatureId) return null
  return `https://bills.legmt.gov/#/laws/bill/${legislatureId}/${draftNumber}?open_tab=bill`
}

export async function getBills(workspaceId: number) {
  const { rows } = await pool.query<{
    bill_id: number
    bill_type_code: string | null
    chamber: string | null
    bill_number: number | null
    draft_id: number
    draft_number: string
    short_title: string
    legislature_id: number | null
    sine_die_date: string | null
    sponsor_first_name: string | null
    sponsor_last_name: string | null
    sponsor_district: string | null
    sponsor_party: string | null
    subjects: string[] | null
    committee_name: string | null
    status_name: string | null
    status_occurred_at: string | null
    position: string | null
    assignee_id: number | null
  }>(
    `
    SELECT
      b.id AS bill_id,
      bt.code AS bill_type_code,
      bt.chamber,
      b.bill_number,
      d.id AS draft_id,
      d.draft_number,
      d.short_title,
      s.legislature_id,
      s.sine_die_date,
      sp.first_name AS sponsor_first_name,
      sp.last_name AS sponsor_last_name,
      dist.name AS sponsor_district,
      pp.code AS sponsor_party,
      subj.descriptions AS subjects,
      latest_committee.committee_name,
      latest_status.status_name,
      latest_status.occurred_at AS status_occurred_at,
      tb.position,
      tb.assignee_id
    FROM tracked_bills tb
    JOIN bills b ON b.id = tb.bill_id
    JOIN drafts d ON d.id = b.draft_id
    LEFT JOIN sessions s ON s.id = d.session_id
    LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
    LEFT JOIN legislators sp ON sp.id = b.sponsor_id
    LEFT JOIN districts dist ON dist.id = sp.district_id
    LEFT JOIN political_parties pp ON pp.id = sp.political_party_id
    LEFT JOIN LATERAL (
      -- Montana's own "primary" flag on subject_codes is a property of the
      -- subject category itself (nearly every code has it set), not of a
      -- specific bill's assignment — it does NOT mean "this is the bill's
      -- main topic", so picking one "primary" subject per bill was
      -- effectively arbitrary. Surface every tagged subject instead of
      -- guessing at one.
      SELECT array_agg(subj.description ORDER BY subj.description) AS descriptions
      FROM draft_subjects ds
      JOIN subject_codes subj ON subj.id = ds.subject_code_id
      WHERE ds.draft_id = d.id
    ) subj ON true
    LEFT JOIN LATERAL (
      SELECT bsc.name AS status_name, bs.occurred_at
      FROM bill_statuses bs
      LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
      WHERE bs.draft_id = d.id
      ORDER BY bs.occurred_at DESC
      LIMIT 1
    ) latest_status ON true
    LEFT JOIN LATERAL (
      SELECT sc.name AS committee_name
      FROM bill_statuses bs
      JOIN standing_committees sc ON sc.id = bs.standing_committee_id
      WHERE bs.draft_id = d.id AND bs.standing_committee_id IS NOT NULL
      ORDER BY bs.occurred_at DESC
      LIMIT 1
    ) latest_committee ON true
    WHERE tb.workspace_id = $1
    ORDER BY b.id
  `,
    [workspaceId],
  )

  if (rows.length === 0) return []

  const billIds = rows.map((r) => r.bill_id)

  const { rows: statusRows } = await pool.query<{ bill_id: number; occurred_at: string; progress_code: number | null }>(
    `SELECT b.id AS bill_id, bs.occurred_at, pc.code AS progress_code
     FROM bills b
     JOIN bill_statuses bs ON bs.draft_id = b.draft_id
     LEFT JOIN progress_categories pc ON pc.id = bs.progress_category_id
     WHERE b.id = ANY($1)`,
    [billIds],
  )
  const statusesByBill = new Map<number, StatusPoint[]>()
  for (const row of statusRows) {
    const list = statusesByBill.get(row.bill_id) ?? []
    list.push({ occurredAt: new Date(row.occurred_at), progressCode: row.progress_code })
    statusesByBill.set(row.bill_id, list)
  }

  const { rows: activityRows } = await pool.query<{ bill_id: number; occurred_at: string }>(
    `SELECT bill_id, occurred_at FROM bill_votes WHERE bill_id = ANY($1) AND occurred_at IS NOT NULL
     UNION ALL
     SELECT cbh.bill_id, cm.meeting_time AS occurred_at
     FROM committee_bill_hearings cbh
     JOIN committee_meetings cm ON cm.id = cbh.committee_meeting_id
     WHERE cbh.bill_id = ANY($1) AND cm.meeting_time IS NOT NULL`,
    [billIds],
  )
  const activityDatesByBill = new Map<number, Date[]>()
  for (const row of activityRows) {
    const list = activityDatesByBill.get(row.bill_id) ?? []
    list.push(new Date(row.occurred_at))
    activityDatesByBill.set(row.bill_id, list)
  }

  const now = new Date()
  return rows.map((r) => {
    const sponsorName = r.sponsor_first_name || r.sponsor_last_name ? `${r.sponsor_first_name ?? ''} ${r.sponsor_last_name ?? ''}`.trim() : ''
    const statuses = statusesByBill.get(r.bill_id) ?? []
    const momentum = computeMomentum(statuses, activityDatesByBill.get(r.bill_id) ?? [])
    const sessionEnded = r.sine_die_date != null && new Date(r.sine_die_date) < now
    const outcome = determineOutcome(statuses, sessionEnded)

    return {
      id: String(r.bill_id),
      identifier: formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number),
      title: r.short_title,
      officialUrl: buildOfficialBillUrl(r.legislature_id, r.draft_number),
      // The bill's process is over: it became law, its latest status is a
      // final one (died, vetoed, withdrawn, missed a deadline), or its
      // session ended.
      closed: outcome != null || isProgressStopped(statuses),
      sponsor: { name: sponsorName, district: r.sponsor_district ?? '', party: r.sponsor_party ?? '' },
      committee: r.committee_name ?? undefined,
      chamber: r.chamber ? (r.chamber.toLowerCase() as 'house' | 'senate') : undefined,
      subjects: r.subjects ?? [],
      status: r.status_name ?? 'Unknown',
      lastAction: {
        text: r.status_name ?? 'No recorded action',
        date: r.status_occurred_at ?? new Date().toISOString(),
      },
      position: r.position as 'support' | 'oppose' | 'watch' | 'neutral' | null,
      assigneeId: r.assignee_id != null ? String(r.assignee_id) : null,
      momentum,
      outcome,
    }
  })
}

export async function getWorkspaceMembers(workspaceId: number) {
  const { rows } = await pool.query<{ id: number; name: string; initials: string; color: string }>(
    `SELECT u.id, u.name, u.initials, u.color
     FROM workspace_members wm JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY u.name`,
    [workspaceId],
  )
  return rows.map((r) => ({ id: String(r.id), name: r.name, initials: r.initials, color: r.color }))
}

export async function getSavedViews(workspaceId: number) {
  const { rows } = await pool.query(
    'SELECT id, name, color, query FROM saved_views WHERE workspace_id = $1 ORDER BY created_at',
    [workspaceId],
  )
  return rows
}

export async function getMomentumFactors() {
  // Mirrors the real formula in momentum.ts — keep these two in sync.
  return [
    { weight: 60, label: 'Progress reached — furthest legislative stage achieved' },
    { weight: 25, label: 'Action recency — days since last status change' },
    { weight: 15, label: 'Legislative activity — floor votes + hearings, capped at 10' },
  ]
}

export async function getTeamBoard(workspaceId: number) {
  const { rows: activity } = await pool.query<{
    id: number
    actor_id: number | null
    verb: string
    detail: string
    bill_id: number | null
    occurred_at: string
  }>(
    `SELECT id, actor_id, verb, detail, bill_id, occurred_at FROM activity_log
     WHERE workspace_id = $1 ORDER BY occurred_at DESC LIMIT 10`,
    [workspaceId],
  )

  const { rows: toReviewRows } = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM tracked_bills WHERE workspace_id = $1 AND position IS NULL',
    [workspaceId],
  )
  const { rows: testimonyDraftRows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM testimony WHERE workspace_id = $1 AND status = 'draft'",
    [workspaceId],
  )

  return {
    activity: activity.map((a) => ({
      id: String(a.id),
      actorId: a.actor_id != null ? String(a.actor_id) : '',
      verb: a.verb,
      detail: a.detail,
      billId: a.bill_id != null ? String(a.bill_id) : undefined,
      timestamp: a.occurred_at,
    })),
    toReview: Number(toReviewRows[0]?.n ?? 0),
    testimonyDrafts: Number(testimonyDraftRows[0]?.n ?? 0),
    overdue: 0,
  }
}

export async function getNavCounts(workspaceId: number) {
  const { rows } = await pool.query<{
    all_bills: string
    lc_drafts: string
    introduced: string
  }>(
    `
    SELECT
      count(*) AS all_bills,
      count(*) FILTER (WHERE b.bill_number IS NULL) AS lc_drafts,
      count(*) FILTER (WHERE b.bill_number IS NOT NULL) AS introduced
    FROM tracked_bills tb JOIN bills b ON b.id = tb.bill_id
    WHERE tb.workspace_id = $1
  `,
    [workspaceId],
  )
  const { rows: legislatorRows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM legislators l WHERE ${realLegislatorSql('l')}`,
  )
  const { rows: hearingRows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM non_standing_committee_meetings WHERE meeting_time >= now()`,
  )
  const { rows: toReviewRows } = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM tracked_bills WHERE workspace_id = $1 AND position IS NULL',
    [workspaceId],
  )
  const { rows: notesRows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM notes WHERE workspace_id = $1', [
    workspaceId,
  ])
  const { rows: watchRows } = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM subject_watches WHERE workspace_id = $1',
    [workspaceId],
  )
  const { rows: committeeRows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM non_standing_committees')
  const { rows: testimonyDraftRows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM testimony WHERE workspace_id = $1 AND status = 'draft'",
    [workspaceId],
  )

  const row = rows[0]
  return {
    allBills: Number(row?.all_bills ?? 0),
    lcDrafts: Number(row?.lc_drafts ?? 0),
    introduced: Number(row?.introduced ?? 0),
    hearings: Number(hearingRows[0]?.n ?? 0),
    legislators: Number(legislatorRows[0]?.n ?? 0),
    trackingBoard: Number(toReviewRows[0]?.n ?? 0),
    notes: Number(notesRows[0]?.n ?? 0),
    subjectWatches: Number(watchRows[0]?.n ?? 0),
    interimCommittees: Number(committeeRows[0]?.n ?? 0),
    testimony: Number(testimonyDraftRows[0]?.n ?? 0),
  }
}

// Montana wall-clock time now. Scraped meeting times are naive Montana time.
const NOW_MT = `(now() AT TIME ZONE 'America/Denver')`

// The dashboard strip. The counts are for this workspace only: the LC drafts
// that it tracks for the next session, and the meetings of the committees
// that it follows.
// Bill deadlines. The Legislature sets each deadline as a legislative day
// (deadline_codes) and plans the date of each day (legislative_calendar_days).

const DEADLINE_LABELS: Record<string, string> = {
  GE: 'General bills',
  RE: 'Revenue bills',
  AP: 'Appropriation bills',
  RP: 'Referendum proposals',
  RR: 'Revenue estimating resolution',
  IS: 'Interim study resolutions',
  AD: 'No deadline',
}

// The transmittal deadlines that the dashboard counts down to, in order.
const DASHBOARD_TRANSMITTAL_CODES = ['GE', 'RE', 'AP']

export interface SessionDeadline {
  code: string
  label: string
  transmittalDay: number | null
  transmittalDate: string | null
  returnDay: number | null
  returnDate: string | null
}

/** The deadlines of each deadline code in a session. A date is null when the calendar has no date for the day. */
async function sessionDeadlines(sessionId: number): Promise<SessionDeadline[]> {
  const { rows } = await pool.query<{
    code: string
    description: string
    transmit_offset_day: number | null
    return_offset_day: number | null
    transmittal_date: string | null
    return_date: string | null
  }>(
    `SELECT dc.code, dc.description, dc.transmit_offset_day, dc.return_offset_day,
            t.calendar_date::text AS transmittal_date, r.calendar_date::text AS return_date
     FROM deadline_codes dc
     LEFT JOIN legislative_calendar_days t ON t.session_id = $1 AND t.calendar_day = dc.transmit_offset_day
     LEFT JOIN legislative_calendar_days r ON r.session_id = $1 AND r.calendar_day = dc.return_offset_day
     ORDER BY dc.transmit_offset_day NULLS LAST, dc.id`,
    [sessionId],
  )
  return rows.map((r) => ({
    code: r.code,
    label: DEADLINE_LABELS[r.code] ?? r.description,
    transmittalDay: r.transmit_offset_day,
    transmittalDate: r.transmittal_date,
    returnDay: r.return_offset_day,
    returnDate: r.return_date,
  }))
}

/** Today in Montana, "YYYY-MM-DD". */
async function todayMt(): Promise<string> {
  const { rows } = await pool.query<{ today: string }>(`SELECT ${NOW_MT}::date::text AS today`)
  return rows[0].today
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000)
}

// The transmittal countdown of the dashboard: the session that has not
// ended (the newest one), and the next of its transmittal deadlines.
async function transmittalCountdown() {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT s.id FROM sessions s
     WHERE s.sine_die_date IS NULL OR s.sine_die_date >= ${NOW_MT}
     ORDER BY s.start_date DESC NULLS LAST
     LIMIT 1`,
  )
  const empty = { daysToTransmittal: null, transmittalDate: null, transmittalLabel: null, laterTransmittals: [], transmittalsPassed: false }
  if (!rows[0]) return empty
  const today = await todayMt()
  const deadlines = (await sessionDeadlines(rows[0].id))
    .filter((d) => DASHBOARD_TRANSMITTAL_CODES.includes(d.code) && d.transmittalDate)
    .sort((a, b) => a.transmittalDate!.localeCompare(b.transmittalDate!))
  if (deadlines.length === 0) return empty
  const upcoming = deadlines.filter((d) => d.transmittalDate! >= today)
  if (upcoming.length === 0) return { ...empty, transmittalsPassed: true }
  const [next, ...later] = upcoming
  return {
    daysToTransmittal: daysBetween(today, next.transmittalDate!),
    transmittalDate: next.transmittalDate,
    transmittalLabel: next.label,
    laterTransmittals: later.map((d) => ({ label: d.label, date: d.transmittalDate! })),
    transmittalsPassed: false,
  }
}

export async function getSessionCalendar(workspaceId: number) {
  const { rows: sessionRows } = await pool.query<{
    id: number
    ordinals: string
    start_date: string | null
    legislature_ordinal: number
  }>(
    `SELECT s.id, s.ordinals, s.start_date, l.ordinal AS legislature_ordinal
     FROM sessions s JOIN legislatures l ON l.id = s.legislature_id
     WHERE s.start_date >= CURRENT_DATE
     ORDER BY s.start_date ASC
     LIMIT 1`,
  )
  const nextSession = sessionRows[0]

  let lcDraftsFiled = 0
  let lcDraftsDelta7d = 0
  if (nextSession) {
    const { rows } = await pool.query<{ total: string; recent: string }>(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE tb.tracked_at >= now() - interval '7 days') AS recent
       FROM tracked_bills tb JOIN bills b ON b.id = tb.bill_id
       WHERE tb.workspace_id = $2 AND b.session_id = $1 AND b.bill_number IS NULL`,
      [nextSession.id, workspaceId],
    )
    lcDraftsFiled = Number(rows[0]?.total ?? 0)
    lcDraftsDelta7d = Number(rows[0]?.recent ?? 0)
  }

  const { rows: hearingRows } = await pool.query<{ n: string; committees: string[] }>(
    `SELECT count(*) AS n, coalesce(array_agg(DISTINCT nsc.name), '{}') AS committees
     FROM non_standing_committee_meetings m
     JOIN non_standing_committees nsc ON nsc.id = m.non_standing_committee_id
     JOIN followed_committees fc ON fc.committee_id = nsc.id AND fc.workspace_id = $1
     WHERE m.meeting_time BETWEEN ${NOW_MT} AND ${NOW_MT} + interval '30 days'
       AND coalesce(m.status, '') <> 'CANCELED'`,
    [workspaceId],
  )

  const daysToConvene = nextSession?.start_date
    ? Math.round((new Date(nextSession.start_date).getTime() - Date.now()) / 86_400_000)
    : null

  return {
    sessionNumber: nextSession?.legislature_ordinal ?? null,
    convenesOn: nextSession?.start_date ?? null,
    daysToConvene,
    lcDraftsFiled,
    lcDraftsDelta7d,
    draftRequestDeadline: null,
    hearingsNext30Days: Number(hearingRows[0]?.n ?? 0),
    hearingCommittees: (hearingRows[0]?.committees ?? []).slice(0, 4),
    ...(await transmittalCountdown()),
  }
}

// Rule-based digest computed from real momentum deltas, untriaged bills, and
// the next scheduled interim hearing — no LLM call involved. The frontend
// label for this panel is "Morning brief" (not "AI-generated"), so this is
// an honest match, not a stand-in for something more sophisticated later.
export async function getBrief(workspaceId: number) {
  const [bills, hearings, activityCount] = await Promise.all([
    getBills(workspaceId),
    getNextInterimMeetings(workspaceId),
    pool.query<{ n: string }>('SELECT count(*) AS n FROM activity_log WHERE workspace_id = $1', [workspaceId]),
  ])

  const sorted = [...bills].sort((a, b) => b.momentum.delta7d - a.momentum.delta7d)
  const topMover = sorted[0]
  const biggestDrop = sorted[sorted.length - 1]
  const untriaged = bills.filter((b) => !b.position)

  const summaryParts: string[] = []
  const boldedBillIds: string[] = []
  if (topMover && topMover.momentum.delta7d > 0) {
    summaryParts.push(
      `**${topMover.identifier}** ("${topMover.title}") shows the strongest 7-day momentum gain among tracked bills.`,
    )
    boldedBillIds.push(topMover.id)
  }
  if (biggestDrop && biggestDrop.momentum.delta7d < 0 && biggestDrop.id !== topMover?.id) {
    summaryParts.push(`**${biggestDrop.identifier}** lost the most ground over the same window.`)
    boldedBillIds.push(biggestDrop.id)
  }
  // A quiet week: one sentence. The tagged items below carry the rest.
  const quiet = summaryParts.length === 0
  if (quiet) summaryParts.push('No tracked bills moved in the last 7 days.')

  const taggedItems: { tag: 'RISK' | 'NEW' | 'CAL'; text: string; sourceIds: string[] }[] = []
  if (untriaged.length > 0) {
    taggedItems.push({
      tag: 'RISK',
      text: `${untriaged.length} tracked bill${untriaged.length === 1 ? '' : 's'} ${untriaged.length === 1 ? 'has' : 'have'} no position set yet.`,
      sourceIds: untriaged.slice(0, 3).map((b) => b.id),
    })
  }
  if (hearings.length > 0) {
    const when = new Date(hearings[0].datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    taggedItems.push({
      tag: 'CAL',
      text: `${hearings[0].committee} meets ${when}. This is the next meeting of a committee that you follow.`,
      sourceIds: [],
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: summaryParts.join(' '),
    quiet,
    boldedBillIds,
    taggedItems,
    sourceCounts: {
      actions: Number(activityCount.rows[0]?.n ?? 0),
      hearings: hearings.length,
      fiscalNotes: 0,
    },
  }
}

// The next meetings of the committees that the workspace follows: the
// brief's calendar item. Recorded hearings (with transcripts) are
// getRecordedHearings() below.
async function getNextInterimMeetings(workspaceId: number) {
  const { rows } = await pool.query<{ committee: string; meeting_time: string }>(
    `SELECT nsc.name AS committee, m.meeting_time
     FROM non_standing_committee_meetings m
     JOIN non_standing_committees nsc ON nsc.id = m.non_standing_committee_id
     JOIN followed_committees fc ON fc.committee_id = nsc.id AND fc.workspace_id = $1
     WHERE m.meeting_time >= ${NOW_MT} AND coalesce(m.status, '') <> 'CANCELED'
     ORDER BY m.meeting_time ASC
     LIMIT 5`,
    [workspaceId],
  )
  return rows.map((r) => ({ committee: r.committee, datetime: r.meeting_time }))
}

// ---------------------------------------------------------------------------
// Recorded hearings (see server/src/transcribeHearings.ts for the pipeline).

const NOMAD_ITEM_PAGE = 'https://streaming-video.legmt.gov/browse/item/'
// The search page of the archive. A search for the committee name lists all
// the archived videos of the committee.
const NOMAD_SEARCH_PAGE = 'https://streaming-video.legmt.gov/search/'

function archiveSearchUrl(committeeName: string): string {
  return `${NOMAD_SEARCH_PAGE}${encodeURIComponent(committeeName)}`
}

interface RecordingRow {
  id: number
  nomad_item_id: string
  committee_id: number | null
  committee_name: string
  meeting_id: number | null
  recorded_at: string
  location: string | null
  duration_seconds: number
  transcript_status: 'pending' | 'processing' | 'ready' | 'failed'
  transcript_source: 'captions' | 'diarized' | null
  is_followed: boolean
  speakers_named: boolean
}

const RECORDING_COLUMNS = `
  r.id, r.nomad_item_id, r.committee_id, r.committee_name, r.meeting_id, r.recorded_at, m.location,
  r.duration_seconds, r.transcript_status, r.transcript_source, (fc.committee_id IS NOT NULL) AS is_followed,
  EXISTS (
    SELECT 1 FROM hearing_speakers sp
    WHERE sp.recording_id = r.id AND sp.label <> 'UNKNOWN' AND sp.display_name NOT LIKE 'Speaker %'
  ) AS speakers_named`

const RECORDING_JOINS = `
  LEFT JOIN non_standing_committee_meetings m ON m.id = r.meeting_id
  LEFT JOIN followed_committees fc ON fc.committee_id = r.committee_id AND fc.workspace_id = $1`

function recordingSummary(r: RecordingRow) {
  return {
    id: String(r.id),
    committee: r.committee_name,
    committeeId: r.committee_id != null ? String(r.committee_id) : null,
    meetingId: r.meeting_id != null ? String(r.meeting_id) : null,
    datetime: r.recorded_at,
    room: r.location,
    durationSeconds: r.duration_seconds,
    transcriptStatus: r.transcript_status,
    transcriptSource: r.transcript_source,
    isFollowed: r.is_followed,
    speakersNamed: r.speakers_named,
    // False for a recording older than the full transcript window: it keeps the captions only.
    fullTranscript: r.recorded_at >= windowStart(FULL_TRANSCRIPT_DAYS),
    sourceUrl: `${NOMAD_ITEM_PAGE}${r.nomad_item_id}?videoPlayback=true`,
  }
}

// Most recent recordings first, but anything from a committee the
// workspace follows (in the last 30 days) jumps the queue — the dashboard's
// player shows the first one.
export async function getRecordedHearings(workspaceId: number) {
  const { rows } = await pool.query<RecordingRow>(
    `SELECT ${RECORDING_COLUMNS}
     FROM hearing_recordings r ${RECORDING_JOINS}
     ORDER BY (fc.committee_id IS NOT NULL AND r.recorded_at >= now() - interval '30 days') DESC,
              r.recorded_at DESC, r.id DESC
     LIMIT 25`,
    [workspaceId],
  )
  return rows.map(recordingSummary)
}

// Spoken references to the workspace's tracked bills: "HB 123" / "House
// Bill 123" / "SB 4" / "LC 1234" as speech recognition writes them.
// Number-words ("house bill one twenty three") aren't attempted.
async function trackedBillPatterns(workspaceId: number): Promise<{ billId: string; pattern: RegExp }[]> {
  const { rows } = await pool.query<{ bill_id: number; code: string | null; bill_number: number | null; draft_number: string | null }>(
    `SELECT b.id AS bill_id, bt.code, b.bill_number, d.draft_number
     FROM tracked_bills tb
     JOIN bills b ON b.id = tb.bill_id
     LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
     LEFT JOIN drafts d ON d.id = b.draft_id
     WHERE tb.workspace_id = $1`,
    [workspaceId],
  )
  const spelledOut: Record<string, string> = { HB: 'House Bill', SB: 'Senate Bill', HJ: 'House Joint Resolution', SJ: 'Senate Joint Resolution', HR: 'House Resolution', SR: 'Senate Resolution' }
  const patterns: { billId: string; pattern: RegExp }[] = []
  for (const r of rows) {
    const alternatives: string[] = []
    if (r.code && r.bill_number != null) {
      const words = spelledOut[r.code.toUpperCase()]
      alternatives.push(`${r.code}\\s*(?:No\\.?\\s*)?${r.bill_number}`)
      if (words) alternatives.push(`${words.replace(/ /g, '\\s+')}\\s*(?:No\\.?\\s*)?${r.bill_number}`)
    }
    const lc = r.draft_number?.match(/^LC\s*0*(\d+)$/i)
    if (lc) alternatives.push(`LC\\s*0*${lc[1]}`)
    if (alternatives.length > 0) {
      patterns.push({ billId: String(r.bill_id), pattern: new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'i') })
    }
  }
  return patterns
}

export async function getHearingDetail(recordingId: number, workspaceId: number) {
  const { rows } = await pool.query<
    RecordingRow & {
      waveform: number[]
      hls_url: string
      audio_playlist_url: string | null
      ai_summary: HearingAiSummary | null
      ai_summary_model: string | null
      ai_summarized_at: string | null
    }
  >(
    `SELECT ${RECORDING_COLUMNS}, r.waveform, r.hls_url, r.audio_playlist_url,
            r.ai_summary, r.ai_summary_model, r.ai_summarized_at
     FROM hearing_recordings r ${RECORDING_JOINS}
     WHERE r.id = $2`,
    [workspaceId, recordingId],
  )
  const r = rows[0]
  if (!r) return null

  const [{ rows: segmentRows }, patterns] = await Promise.all([
    pool.query<{ start_seconds: number; end_seconds: number; text: string; display_name: string | null; legislator_id: number | null }>(
      `SELECT s.start_seconds, s.end_seconds, s.text, sp.display_name, sp.legislator_id
       FROM hearing_transcript_segments s
       LEFT JOIN hearing_speakers sp ON sp.recording_id = s.recording_id AND sp.label = s.speaker_label
       WHERE s.recording_id = $1
       ORDER BY s.seq`,
      [recordingId],
    ),
    trackedBillPatterns(workspaceId),
  ])

  const transcript = segmentRows.map((s) => {
    const mentionedBillIds = patterns.filter((p) => p.pattern.test(s.text)).map((p) => p.billId)
    return {
      timestamp: s.start_seconds,
      endTimestamp: s.end_seconds,
      speaker: s.display_name,
      legislatorId: s.legislator_id != null ? String(s.legislator_id) : null,
      text: s.text,
      mentionedBillIds,
    }
  })

  // The player streams through our own proxy (GET /api/hearings/:id/audio/*)
  // because the archive's CDN sends no CORS headers. The path is relative to
  // the recording's HLS directory, which is all the proxy will serve.
  const baseDir = r.hls_url.slice(0, r.hls_url.lastIndexOf('/') + 1)
  const audioPath = r.audio_playlist_url?.startsWith(baseDir) ? r.audio_playlist_url.slice(baseDir.length) : null

  return {
    ...recordingSummary(r),
    audioUrl: audioPath ? `/api/hearings/${r.id}/audio/${audioPath}` : null,
    waveform: Array.isArray(r.waveform) ? r.waveform : [],
    transcript,
    trackedTermMentions: transcript.filter((t) => t.mentionedBillIds.length > 0).length,
    // The AI summary (summarizeHearings.ts), or null before the job runs.
    aiSummary: r.ai_summary
      ? { ...r.ai_summary, model: r.ai_summary_model, generatedAt: r.ai_summarized_at }
      : null,
  }
}

// Media types for what an HLS stream is made of; anything else is refused.
const HEARING_MEDIA_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.ts': 'video/mp2t',
  '.aac': 'audio/aac',
  '.vtt': 'text/vtt',
}

/**
 * Resolves a proxied hearing-media path to its upstream URL, or null if the
 * path isn't something this recording's stream could contain. Locked to the
 * recording's own HLS directory so the proxy can't be pointed elsewhere.
 */
export async function resolveHearingMediaUrl(
  recordingId: number,
  pathSegments: string[],
): Promise<{ url: string; contentType: string } | null> {
  if (pathSegments.length === 0) return null
  if (!pathSegments.every((seg) => /^[A-Za-z0-9_.-]+$/.test(seg) && seg !== '.' && seg !== '..')) return null
  const file = pathSegments[pathSegments.length - 1]
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  const contentType = HEARING_MEDIA_TYPES[ext]
  if (!contentType) return null
  const { rows } = await pool.query<{ hls_url: string }>('SELECT hls_url FROM hearing_recordings WHERE id = $1', [recordingId])
  if (!rows[0]) return null
  const baseDir = rows[0].hls_url.slice(0, rows[0].hls_url.lastIndexOf('/') + 1)
  return { url: baseDir + pathSegments.join('/'), contentType }
}

// Every future interim-committee meeting, across all committees — not just
// the ones a workspace follows. This is the "browse the full calendar" view
// the left-nav's Hearings item links to. isFollowed is still overlaid per-workspace (same
// LEFT JOIN pattern as getNonStandingCommittees) so the list can highlight
// hearings for committees the team already follows.
export async function getUpcomingHearings(workspaceId: number) {
  const { rows } = await pool.query<{
    id: number
    committee_id: number
    committee: string
    meeting_time: string
    location: string | null
    public_participation: boolean | null
    agenda_count: number
    is_followed: boolean
  }>(
    `
    SELECT m.id, nsc.id AS committee_id, nsc.name AS committee, m.meeting_time, m.location,
           m.public_participation, coalesce(jsonb_array_length(m.agenda_items), 0) AS agenda_count,
           (fc.committee_id IS NOT NULL) AS is_followed
    FROM non_standing_committee_meetings m
    JOIN non_standing_committees nsc ON nsc.id = m.non_standing_committee_id
    LEFT JOIN followed_committees fc ON fc.committee_id = nsc.id AND fc.workspace_id = $1
    WHERE m.meeting_time >= now()
    ORDER BY m.meeting_time ASC
  `,
    [workspaceId],
  )

  return rows.map((r) => ({
    id: String(r.id),
    committeeId: String(r.committee_id),
    committee: r.committee,
    meetingTime: r.meeting_time,
    location: r.location,
    publicParticipation: r.public_participation,
    agendaCount: Number(r.agenda_count),
    isFollowed: r.is_followed,
  }))
}

function bucketVote(v: string | null): 'yes' | 'no' | 'other' {
  if (!v) return 'other'
  const upper = v.toUpperCase()
  if (upper.startsWith('YES')) return 'yes'
  if (upper.startsWith('NO')) return 'no'
  return 'other'
}

// The Legislature's data has system accounts in real seats, for example
// "Service ZZ-User" in Senate District 5. These accounts have a last name that
// starts with "ZZ" or an email address that starts with "service.". This filter
// removes them from the legislator list, the map, and the counts.
function realLegislatorSql(alias: string): string {
  return `NOT (coalesce(${alias}.last_name, '') ILIKE 'zz%' OR coalesce(${alias}.email_address, '') ILIKE 'service.%')`
}

function legislatorLabel(first: string | null, last: string | null): string {
  return `${first ?? ''} ${last ?? ''}`.trim() || 'Unknown legislator'
}

// The full record for the bill-detail page — everything getBills() returns,
// plus the per-bill detail that only exists at bill-detail granularity
// (status timeline, floor votes, committee votes, cosponsors, hearings,
// amendments). Works for any bill, tracked or not — untracked bills just
// come back with position/assignee null and isTracked: false, so the detail
// page can offer a "track this bill" action instead of position/assignee
// editors. The tracked_bills join is scoped to workspaceId inside the JOIN
// condition (not a WHERE), since the row may legitimately not exist for
// this workspace even though the bill itself is global.
export async function getBillDetail(billId: number, workspaceId: number) {
  const { rows: coreRows } = await pool.query<{
    bill_id: number
    bill_type_code: string | null
    chamber: string | null
    bill_number: number | null
    draft_id: number
    draft_number: string
    is_tracked: boolean
    short_title: string
    legislature_id: number | null
    sine_die_date: string | null
    sponsor_first_name: string | null
    sponsor_last_name: string | null
    sponsor_district: string | null
    sponsor_party: string | null
    subjects: string[] | null
    committee_name: string | null
    status_name: string | null
    status_occurred_at: string | null
    position: string | null
    assignee_id: number | null
    summary: string | null
    summary_model: string | null
    summary_generated_at: string | null
    summary_source: string | null
    summary_version_key: string | null
    summary_version_posted_at: string | null
    session_id: number
    deadline_code: string | null
  }>(
    `
    SELECT
      d.session_id,
      dc.code AS deadline_code,
      b.id AS bill_id,
      bt.code AS bill_type_code,
      bt.chamber,
      b.bill_number,
      d.id AS draft_id,
      d.draft_number,
      d.short_title,
      s.legislature_id,
      s.sine_die_date,
      sp.first_name AS sponsor_first_name,
      sp.last_name AS sponsor_last_name,
      dist.name AS sponsor_district,
      pp.code AS sponsor_party,
      subj.descriptions AS subjects,
      latest_committee.committee_name,
      latest_status.status_name,
      latest_status.occurred_at AS status_occurred_at,
      tb.position,
      tb.assignee_id,
      (tb.bill_id IS NOT NULL) AS is_tracked,
      bsum.summary,
      bsum.model AS summary_model,
      bsum.generated_at AS summary_generated_at,
      bsum.source AS summary_source,
      bsum.version_key AS summary_version_key,
      bsum.version_posted_at AS summary_version_posted_at
    FROM bills b
    JOIN drafts d ON d.id = b.draft_id
    LEFT JOIN sessions s ON s.id = d.session_id
    LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $2
    LEFT JOIN bill_summaries bsum ON bsum.bill_id = b.id
    LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
    LEFT JOIN deadline_codes dc ON dc.id = b.deadline_code_id
    LEFT JOIN legislators sp ON sp.id = b.sponsor_id
    LEFT JOIN districts dist ON dist.id = sp.district_id
    LEFT JOIN political_parties pp ON pp.id = sp.political_party_id
    LEFT JOIN LATERAL (
      -- See the matching comment in getBills() — Montana's "primary" flag on
      -- subject_codes is not per-bill, so we surface every tagged subject.
      SELECT array_agg(subj.description ORDER BY subj.description) AS descriptions
      FROM draft_subjects ds
      JOIN subject_codes subj ON subj.id = ds.subject_code_id
      WHERE ds.draft_id = d.id
    ) subj ON true
    LEFT JOIN LATERAL (
      SELECT bsc.name AS status_name, bs.occurred_at
      FROM bill_statuses bs
      LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
      WHERE bs.draft_id = d.id
      ORDER BY bs.occurred_at DESC
      LIMIT 1
    ) latest_status ON true
    LEFT JOIN LATERAL (
      SELECT sc.name AS committee_name
      FROM bill_statuses bs
      JOIN standing_committees sc ON sc.id = bs.standing_committee_id
      WHERE bs.draft_id = d.id AND bs.standing_committee_id IS NOT NULL
      ORDER BY bs.occurred_at DESC
      LIMIT 1
    ) latest_committee ON true
    WHERE b.id = $1
    `,
    [billId, workspaceId],
  )
  const core = coreRows[0]
  if (!core) return null

  const [statusRows, statusHistoryRows, voteRows, executiveActionRows, cosponsorRows, hearingRows, amendmentRows, versionRows] =
    await Promise.all([
      pool.query<{ occurred_at: string; progress_code: number | null }>(
        `SELECT bs.occurred_at, pc.code AS progress_code
         FROM bill_statuses bs LEFT JOIN progress_categories pc ON pc.id = bs.progress_category_id
         WHERE bs.draft_id = $1`,
        [core.draft_id],
      ),
      pool.query<{
        id: number
        occurred_at: string
        status_name: string | null
        progress_category: string | null
        committee_name: string | null
        result: string | null
      }>(
        `SELECT bs.id, bs.occurred_at, bsc.name AS status_name, pc.description AS progress_category,
                sc.name AS committee_name, bs.result
         FROM bill_statuses bs
         LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
         LEFT JOIN progress_categories pc ON pc.id = bs.progress_category_id
         LEFT JOIN standing_committees sc ON sc.id = bs.standing_committee_id
         WHERE bs.draft_id = $1
         ORDER BY bs.occurred_at ASC`,
        [core.draft_id],
      ),
      pool.query<{
        vote_id: number
        motion: string | null
        occurred_at: string | null
        chamber: string | null
        result: string | null
        legislator_id: number | null
        vote_type: string | null
        first_name: string | null
        last_name: string | null
        party: string | null
      }>(
        `SELECT bv.id AS vote_id, bv.motion, bv.occurred_at, bv.chamber, bv.result,
                lv.legislator_id, lv.vote_type, l.first_name, l.last_name, pp.code AS party
         FROM bill_votes bv
         LEFT JOIN bill_vote_legislator_votes lv ON lv.bill_vote_id = bv.id
         LEFT JOIN legislators l ON l.id = lv.legislator_id
         LEFT JOIN political_parties pp ON pp.id = l.political_party_id
         WHERE bv.bill_id = $1
         ORDER BY bv.occurred_at ASC, lv.id ASC`,
        [billId],
      ),
      pool.query<{
        action_id: number
        motion: string | null
        vote_time: string | null
        committee_name: string | null
        legislator_id: number | null
        committee_vote: string | null
        first_name: string | null
        last_name: string | null
        party: string | null
      }>(
        `SELECT ea.id AS action_id, ea.motion, ea.vote_time, sc.name AS committee_name,
                lv.legislator_id, lv.committee_vote, l.first_name, l.last_name, pp.code AS party
         FROM executive_actions ea
         LEFT JOIN committee_meetings cm ON cm.id = ea.committee_meeting_id
         LEFT JOIN standing_committees sc ON sc.id = cm.standing_committee_id
         LEFT JOIN executive_action_legislator_votes lv ON lv.executive_action_id = ea.id
         LEFT JOIN legislators l ON l.id = lv.legislator_id
         LEFT JOIN political_parties pp ON pp.id = l.political_party_id
         WHERE ea.bill_id = $1
         ORDER BY ea.vote_time ASC, lv.id ASC`,
        [billId],
      ),
      pool.query<{ legislator_id: number; first_name: string | null; last_name: string | null; district: string | null; party: string | null }>(
        `SELECT l.id AS legislator_id, l.first_name, l.last_name, dist.name AS district, pp.code AS party
         FROM bill_cosponsors bc
         JOIN legislators l ON l.id = bc.legislator_id
         LEFT JOIN districts dist ON dist.id = l.district_id
         LEFT JOIN political_parties pp ON pp.id = l.political_party_id
         WHERE bc.bill_id = $1
         ORDER BY l.last_name ASC`,
        [billId],
      ),
      pool.query<{ id: number; meeting_time: string | null; location: string | null; committee_name: string | null }>(
        `SELECT cm.id, cm.meeting_time, cm.location, sc.name AS committee_name
         FROM committee_bill_hearings h
         JOIN committee_meetings cm ON cm.id = h.committee_meeting_id
         LEFT JOIN standing_committees sc ON sc.id = cm.standing_committee_id
         WHERE h.bill_id = $1
         ORDER BY cm.meeting_time ASC`,
        [billId],
      ),
      pool.query<{
        id: number
        number: number | null
        type: string | null
        bill_version: number | null
        section: string | null
        document_id: number | null
        summary: string | null
        posted_at: string | null
      }>(
        // The newest amendment file of each amendment (refreshBillTexts.ts).
        `SELECT a.id, a.number, a.type, a.bill_version, a.section,
                ad.id AS document_id, ad.summary, ad.posted_at
         FROM amendments a
         LEFT JOIN LATERAL (
           SELECT id, summary, posted_at FROM amendment_documents
           WHERE amendment_id = a.id AND changes IS NOT NULL
           ORDER BY posted_at DESC NULLS LAST LIMIT 1
         ) ad ON true
         WHERE a.bill_id = $1
         ORDER BY a.bill_version ASC NULLS LAST, CASE WHEN a.section ~ '^[A-Z]$' THEN a.section END ASC NULLS FIRST,
                  a.number ASC`,
        [billId],
      ),
      pool.query<{ version_key: string; posted_at: string | null }>(
        `SELECT version_key, posted_at FROM bill_text_versions WHERE bill_id = $1`,
        [billId],
      ),
    ])

  const statuses: StatusPoint[] = statusRows.rows.map((r) => ({
    occurredAt: new Date(r.occurred_at),
    progressCode: r.progress_code,
  }))
  const activityDates: Date[] = [
    ...new Set(voteRows.rows.map((r) => r.occurred_at).filter((d): d is string => d != null)),
    ...hearingRows.rows.map((r) => r.meeting_time).filter((d): d is string => d != null),
  ].map((d) => new Date(d))
  const momentum = computeMomentum(statuses, activityDates)
  const sessionEnded = core.sine_die_date != null && new Date(core.sine_die_date) < new Date()
  const outcome = determineOutcome(statuses, sessionEnded)

  const votesById = new Map<
    number,
    { id: string; motion: string | null; occurredAt: string | null; chamber: string | null; result: string | null; tally: { yes: number; no: number; other: number }; legislatorVotes: { legislatorId: number; name: string; party: string | null; voteType: string | null }[] }
  >()
  for (const r of voteRows.rows) {
    if (!votesById.has(r.vote_id)) {
      votesById.set(r.vote_id, {
        id: String(r.vote_id),
        motion: r.motion,
        occurredAt: r.occurred_at,
        chamber: r.chamber,
        result: r.result,
        tally: { yes: 0, no: 0, other: 0 },
        legislatorVotes: [],
      })
    }
    const vote = votesById.get(r.vote_id)!
    if (r.legislator_id != null) {
      vote.tally[bucketVote(r.vote_type)] += 1
      vote.legislatorVotes.push({
        legislatorId: r.legislator_id,
        name: legislatorLabel(r.first_name, r.last_name),
        party: r.party,
        voteType: r.vote_type,
      })
    }
  }

  const actionsById = new Map<
    number,
    { id: string; motion: string | null; voteTime: string | null; committee: string | null; tally: { yes: number; no: number; other: number }; legislatorVotes: { legislatorId: number; name: string; party: string | null; voteType: string | null }[] }
  >()
  for (const r of executiveActionRows.rows) {
    if (!actionsById.has(r.action_id)) {
      actionsById.set(r.action_id, {
        id: String(r.action_id),
        motion: r.motion,
        voteTime: r.vote_time,
        committee: r.committee_name,
        tally: { yes: 0, no: 0, other: 0 },
        legislatorVotes: [],
      })
    }
    const action = actionsById.get(r.action_id)!
    if (r.legislator_id != null) {
      action.tally[bucketVote(r.committee_vote)] += 1
      action.legislatorVotes.push({
        legislatorId: r.legislator_id,
        name: legislatorLabel(r.first_name, r.last_name),
        party: r.party,
        voteType: r.committee_vote,
      })
    }
  }

  const sponsorName = core.sponsor_first_name || core.sponsor_last_name ? legislatorLabel(core.sponsor_first_name, core.sponsor_last_name) : ''
  // The transmittal and return deadlines of the deadline category of the bill.
  // An LC draft has no category until it is introduced.
  const deadline = core.deadline_code
    ? ((await sessionDeadlines(core.session_id)).find((d) => d.code === core.deadline_code) ?? null)
    : null

  return {
    id: String(core.bill_id),
    identifier: formatIdentifier(core.bill_type_code, core.bill_number, core.draft_number),
    draftNumber: core.draft_number,
    officialUrl: buildOfficialBillUrl(core.legislature_id, core.draft_number),
    title: core.short_title,
    sponsor: { name: sponsorName, district: core.sponsor_district ?? '', party: core.sponsor_party ?? '' },
    committee: core.committee_name ?? undefined,
    chamber: core.chamber ? (core.chamber.toLowerCase() as 'house' | 'senate') : undefined,
    subjects: core.subjects ?? [],
    status: core.status_name ?? 'Unknown',
    lastAction: {
      text: core.status_name ?? 'No recorded action',
      date: core.status_occurred_at ?? new Date().toISOString(),
    },
    position: core.position as 'support' | 'oppose' | 'watch' | 'neutral' | null,
    assigneeId: core.assignee_id != null ? String(core.assignee_id) : null,
    isTracked: core.is_tracked,
    deadline,
    aiSummary: core.summary
      ? {
          text: core.summary,
          model: core.summary_model,
          generatedAt: core.summary_generated_at,
          // 'text': from the bill text of one version. 'metadata': from the
          // title, subject, sponsor, and status (no bill text yet).
          source: core.summary_source as 'text' | 'metadata',
          versionLabel: core.summary_version_key ? versionLabel(core.summary_version_key) : null,
          versionPostedAt: core.summary_version_posted_at,
        }
      : null,
    momentum,
    outcome,
    statusHistory: statusHistoryRows.rows.map((r) => ({
      id: String(r.id),
      occurredAt: r.occurred_at,
      status: r.status_name ?? 'Unknown',
      progressCategory: r.progress_category,
      committee: r.committee_name,
      result: r.result,
    })),
    votes: [...votesById.values()],
    executiveActions: [...actionsById.values()],
    cosponsors: cosponsorRows.rows.map((r) => ({
      legislatorId: r.legislator_id,
      name: legislatorLabel(r.first_name, r.last_name),
      district: r.district,
      party: r.party,
    })),
    hearings: hearingRows.rows.map((r) => ({
      id: String(r.id),
      committee: r.committee_name,
      datetime: r.meeting_time,
      room: r.location,
    })),
    amendments: amendmentRows.rows.map((r) => ({
      id: String(r.id),
      number: r.number,
      type: r.type,
      billVersion: r.bill_version,
      // HB 2 groups its amendments by section letter (A to E).
      section: r.section && /^[A-Z]$/.test(r.section) ? r.section : null,
      documentId: r.document_id != null ? String(r.document_id) : null,
      summary: r.summary,
      postedAt: r.posted_at,
    })),
    textVersions: versionRows.rows
      .map((r) => ({ key: r.version_key, label: versionLabel(r.version_key), postedAt: r.posted_at }))
      .sort((a, b) => versionOrder(a.key) - versionOrder(b.key)),
  }
}

// Every session we've scraped, with real bill counts and a status computed
// from real dates — no separate "which session is current" flag to keep in
// sync by hand. 'active' means underway right now (start_date <= today <=
// sine_die, or no sine_die yet recorded); 'upcoming' hasn't started;
// 'past' has concluded. tracked_count is scoped to the calling workspace;
// bill_count is global (same real session data for everyone).
export async function getSessions(workspaceId: number) {
  const { rows } = await pool.query<{
    id: number
    ordinals: string
    legislature_ordinal: number
    start_date: string | null
    sine_die_date: string | null
    bill_count: string
    tracked_count: string
  }>(
    `
    SELECT
      s.id, s.ordinals, l.ordinal AS legislature_ordinal, s.start_date, s.sine_die_date,
      -- Not the e2e fixture bills (negative ids), so that a fixture does not
      -- change which session looks current to the other tests.
      count(b.id) FILTER (WHERE b.id > 0) AS bill_count,
      count(tb.bill_id) FILTER (WHERE tb.workspace_id = $1) AS tracked_count
    FROM sessions s
    JOIN legislatures l ON l.id = s.legislature_id
    LEFT JOIN bills b ON b.session_id = s.id
    LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $1
    GROUP BY s.id, s.ordinals, l.ordinal, s.start_date, s.sine_die_date
    ORDER BY s.start_date DESC
  `,
    [workspaceId],
  )

  const today = new Date()
  return rows.map((r) => {
    const start = r.start_date ? new Date(r.start_date) : null
    const sineDie = r.sine_die_date ? new Date(r.sine_die_date) : null
    let status: 'upcoming' | 'active' | 'past' = 'upcoming'
    if (start && start <= today) status = sineDie && sineDie < today ? 'past' : 'active'
    return {
      id: String(r.id),
      ordinals: r.ordinals,
      legislatureOrdinal: r.legislature_ordinal,
      startDate: r.start_date,
      sineDieDate: r.sine_die_date,
      status,
      billCount: Number(r.bill_count),
      trackedCount: Number(r.tracked_count),
    }
  })
}

// Every bill in a session — not just tracked ones — for the session
// browser. Deliberately lighter than getBills(): no momentum (expensive to
// compute per-bill and not meaningful at browse-all scale), no per-bill
// status-history batch join. is_tracked is scoped to the calling workspace.
export async function getSessionBills(sessionId: number, workspaceId: number) {
  const { rows } = await pool.query<{
    bill_id: number
    bill_type_code: string | null
    bill_number: number | null
    draft_number: string
    short_title: string
    sponsor_first_name: string | null
    sponsor_last_name: string | null
    sponsor_party: string | null
    status_name: string | null
    is_tracked: boolean
  }>(
    `
    SELECT
      b.id AS bill_id, bt.code AS bill_type_code, b.bill_number, d.draft_number, d.short_title,
      sp.first_name AS sponsor_first_name, sp.last_name AS sponsor_last_name, pp.code AS sponsor_party,
      latest_status.status_name,
      (tb.bill_id IS NOT NULL) AS is_tracked
    FROM bills b
    JOIN drafts d ON d.id = b.draft_id
    LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
    LEFT JOIN legislators sp ON sp.id = b.sponsor_id
    LEFT JOIN political_parties pp ON pp.id = sp.political_party_id
    LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $2
    LEFT JOIN LATERAL (
      SELECT bsc.name AS status_name, bs.occurred_at
      FROM bill_statuses bs
      LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
      WHERE bs.draft_id = d.id
      ORDER BY bs.occurred_at DESC
      LIMIT 1
    ) latest_status ON true
    WHERE b.session_id = $1
    ORDER BY b.bill_number NULLS LAST, d.draft_number
    `,
    [sessionId, workspaceId],
  )

  return rows.map((r) => ({
    id: String(r.bill_id),
    identifier: formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number),
    title: r.short_title,
    sponsor: legislatorLabel(r.sponsor_first_name, r.sponsor_last_name),
    party: r.sponsor_party,
    status: r.status_name ?? 'Unknown',
    isTracked: r.is_tracked,
  }))
}

export async function getLegislators() {
  const { rows } = await pool.query<{
    id: number
    first_name: string | null
    last_name: string | null
    chamber: string | null
    party: string | null
    district: string | null
    legislature_ordinal: number | null
    sponsored_count: string
  }>(`
    SELECT
      l.id, l.first_name, l.last_name, l.chamber,
      pp.code AS party, dist.name AS district, leg.ordinal AS legislature_ordinal,
      count(b.id) AS sponsored_count
    FROM legislators l
    LEFT JOIN political_parties pp ON pp.id = l.political_party_id
    LEFT JOIN districts dist ON dist.id = l.district_id
    LEFT JOIN legislatures leg ON leg.id = l.legislature_id
    LEFT JOIN bills b ON b.sponsor_id = l.id
    WHERE ${realLegislatorSql('l')}
    GROUP BY l.id, l.first_name, l.last_name, l.chamber, pp.code, dist.name, leg.ordinal
    ORDER BY l.last_name NULLS LAST, l.first_name NULLS LAST
  `)

  return rows.map((r) => ({
    id: String(r.id),
    name: legislatorLabel(r.first_name, r.last_name),
    chamber: r.chamber ? (r.chamber.toLowerCase() as 'house' | 'senate') : null,
    party: r.party,
    district: r.district,
    legislatureOrdinal: r.legislature_ordinal,
    sponsoredCount: Number(r.sponsored_count),
  }))
}

export async function getLegislatorDetail(legislatorId: number) {
  const { rows: coreRows } = await pool.query<{
    id: number
    first_name: string | null
    last_name: string | null
    chamber: string | null
    party: string | null
    district: string | null
    district_number: number | null
    email_address: string | null
    phone_number: string | null
    city: string | null
    home_county: string | null
    legislature_ordinal: number | null
  }>(
    `SELECT l.id, l.first_name, l.last_name, l.chamber, pp.code AS party, dist.name AS district,
            dist.number AS district_number,
            l.email_address, l.phone_number, l.city, l.home_county, leg.ordinal AS legislature_ordinal
     FROM legislators l
     LEFT JOIN political_parties pp ON pp.id = l.political_party_id
     LEFT JOIN districts dist ON dist.id = l.district_id
     LEFT JOIN legislatures leg ON leg.id = l.legislature_id
     WHERE l.id = $1`,
    [legislatorId],
  )
  const core = coreRows[0]
  if (!core) return null

  const [sponsoredRows, cosponsoredRows, standingRows, nonStandingRows, voteRows] = await Promise.all([
    pool.query<{ bill_id: number; bill_type_code: string | null; bill_number: number | null; draft_number: string; short_title: string }>(
      `SELECT b.id AS bill_id, bt.code AS bill_type_code, b.bill_number, d.draft_number, d.short_title
       FROM bills b JOIN drafts d ON d.id = b.draft_id LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
       WHERE b.sponsor_id = $1 ORDER BY b.id`,
      [legislatorId],
    ),
    pool.query<{ bill_id: number; bill_type_code: string | null; bill_number: number | null; draft_number: string; short_title: string }>(
      `SELECT b.id AS bill_id, bt.code AS bill_type_code, b.bill_number, d.draft_number, d.short_title
       FROM bill_cosponsors bc
       JOIN bills b ON b.id = bc.bill_id
       JOIN drafts d ON d.id = b.draft_id
       LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
       WHERE bc.legislator_id = $1 ORDER BY b.id`,
      [legislatorId],
    ),
    pool.query<{ committee_name: string; role_name: string | null }>(
      `SELECT sc.name AS committee_name, cm.role_name
       FROM committee_memberships cm JOIN standing_committees sc ON sc.id = cm.committee_id
       WHERE cm.legislator_id = $1 ORDER BY sc.name`,
      [legislatorId],
    ),
    pool.query<{ committee_name: string; role_name: string | null }>(
      `SELECT nsc.name AS committee_name, nscm.role_name
       FROM non_standing_committee_memberships nscm JOIN non_standing_committees nsc ON nsc.id = nscm.committee_id
       WHERE nscm.legislator_id = $1 ORDER BY nsc.name`,
      [legislatorId],
    ),
    pool.query<{
      bill_id: number
      bill_type_code: string | null
      bill_number: number | null
      draft_number: string
      occurred_at: string | null
      vote_type: string | null
    }>(
      `SELECT bv.bill_id, bt.code AS bill_type_code, b.bill_number, d.draft_number, bv.occurred_at, lv.vote_type
       FROM bill_vote_legislator_votes lv
       JOIN bill_votes bv ON bv.id = lv.bill_vote_id
       JOIN bills b ON b.id = bv.bill_id
       JOIN drafts d ON d.id = b.draft_id
       LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
       WHERE lv.legislator_id = $1
       ORDER BY bv.occurred_at DESC
       LIMIT 25`,
      [legislatorId],
    ),
  ])

  const tally = { yes: 0, no: 0, other: 0 }
  for (const r of voteRows.rows) {
    const upper = (r.vote_type ?? '').toUpperCase()
    if (upper.startsWith('YES')) tally.yes += 1
    else if (upper.startsWith('NO')) tally.no += 1
    else tally.other += 1
  }

  const billLine = (r: { bill_id: number; bill_type_code: string | null; bill_number: number | null; draft_number: string; short_title?: string }) => ({
    id: String(r.bill_id),
    identifier: formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number),
    title: r.short_title ?? null,
  })

  return {
    id: String(core.id),
    name: legislatorLabel(core.first_name, core.last_name),
    chamber: core.chamber ? (core.chamber.toLowerCase() as 'house' | 'senate') : null,
    party: core.party,
    district: core.district,
    // 1 to 100 for a real district. The source data also has placeholder districts.
    districtNumber: core.district_number != null && core.district_number <= 100 ? core.district_number : null,
    email: core.email_address,
    phone: core.phone_number,
    city: core.city,
    homeCounty: core.home_county,
    legislatureOrdinal: core.legislature_ordinal,
    sponsoredBills: sponsoredRows.rows.map((r) => billLine(r)),
    cosponsoredBills: cosponsoredRows.rows.map((r) => billLine(r)),
    committees: [
      ...standingRows.rows.map((r) => ({ name: r.committee_name, role: r.role_name, type: 'standing' as const })),
      ...nonStandingRows.rows.map((r) => ({ name: r.committee_name, role: r.role_name, type: 'interim' as const })),
    ],
    recentVotesTally: tally,
    recentVotes: voteRows.rows.map((r) => ({
      ...billLine(r),
      occurredAt: r.occurred_at,
      voteType: r.vote_type,
    })),
  }
}

type NoteRow = {
  id: number
  bill_id: number | null
  bill_type_code: string | null
  bill_number: number | null
  draft_number: string | null
  short_title: string | null
  author_id: number | null
  author_name: string | null
  body: string
  source_hearing: string | null
  created_at: string
}

function shapeNote(r: NoteRow) {
  return {
    id: String(r.id),
    billId: r.bill_id != null ? String(r.bill_id) : null,
    billIdentifier: r.bill_type_code || r.draft_number ? formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number ?? '') : null,
    billTitle: r.short_title,
    authorId: r.author_id != null ? String(r.author_id) : null,
    authorName: r.author_name,
    body: r.body,
    sourceHearing: r.source_hearing,
    createdAt: r.created_at,
  }
}

const NOTE_SELECT = `
  SELECT n.id, n.bill_id, bt.code AS bill_type_code, b.bill_number, d.draft_number, d.short_title,
         n.author_id, u.name AS author_name, n.body, n.source_hearing, n.created_at
  FROM notes n
  LEFT JOIN bills b ON b.id = n.bill_id
  LEFT JOIN drafts d ON d.id = b.draft_id
  LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
  LEFT JOIN users u ON u.id = n.author_id
`

export async function getNotes(workspaceId: number) {
  const { rows } = await pool.query<NoteRow>(`${NOTE_SELECT} WHERE n.workspace_id = $1 ORDER BY n.created_at DESC`, [
    workspaceId,
  ])
  return rows.map(shapeNote)
}

export async function getBillNotes(billId: number, workspaceId: number) {
  const { rows } = await pool.query<NoteRow>(
    `${NOTE_SELECT} WHERE n.workspace_id = $1 AND n.bill_id = $2 ORDER BY n.created_at DESC`,
    [workspaceId, billId],
  )
  return rows.map(shapeNote)
}

// --- Custom tags ---------------------------------------------------------
// User-defined labels on top of the official subject_codes taxonomy — cover
// coalition-specific groupings ("our priority list") the state's own
// classification was never going to have. Feed into subject watches below
// alongside official subject codes.

export async function getSubjectCodes() {
  const { rows } = await pool.query<{ code: string; description: string }>(
    'SELECT code, description FROM subject_codes ORDER BY description',
  )
  return rows.map((r) => ({ code: r.code, description: r.description }))
}

export async function getTags(workspaceId: number) {
  const { rows } = await pool.query<{ id: number; name: string; usage_count: string }>(
    `
    SELECT t.id, t.name, count(bt.bill_id) AS usage_count
    FROM tags t
    LEFT JOIN bill_tags bt ON bt.tag_id = t.id
    WHERE t.workspace_id = $1
    GROUP BY t.id, t.name
    ORDER BY t.name
  `,
    [workspaceId],
  )
  return rows.map((r) => ({ id: String(r.id), name: r.name, usageCount: Number(r.usage_count) }))
}

export async function getBillTags(billId: number, workspaceId: number) {
  const { rows } = await pool.query<{ id: number; name: string }>(
    `SELECT t.id, t.name FROM bill_tags bt JOIN tags t ON t.id = bt.tag_id
     WHERE bt.bill_id = $1 AND t.workspace_id = $2 ORDER BY t.name`,
    [billId, workspaceId],
  )
  return rows.map((r) => ({ id: String(r.id), name: r.name }))
}

// --- Subject watches -------------------------------------------------------
// A saved set of official subject codes and/or custom tags, evaluated live
// against whichever bills currently match — so a watch surfaces bills the
// team hasn't seen or tracked yet, not just ones already on the board.
// Matching is scoped to the most recent session that actually has scraped
// bills, so it tracks whichever session is the "working" one without a
// separate flag to keep in sync by hand (mirrors getSessions()'s approach).
// tracked_bills in the match/untracked count is scoped to the calling
// workspace; the watch row itself and its tag_ids are already
// workspace-scoped by construction.

// The newest session with scraped bills. Fixture bills (negative ids) do not count.
const WORKING_SESSION_SQL = `(SELECT id FROM sessions WHERE id IN (SELECT DISTINCT session_id FROM bills WHERE id > 0) ORDER BY start_date DESC LIMIT 1)`

export async function getSubjectWatches(workspaceId: number) {
  const { rows } = await pool.query<{
    id: number
    name: string
    subject_codes: string[]
    tag_ids: number[]
    created_at: string
    match_count: string
    untracked_count: string
  }>(
    `
    SELECT
      w.id, w.name, w.subject_codes, w.tag_ids, w.created_at,
      count(b.id) FILTER (WHERE b.id IS NOT NULL) AS match_count,
      count(b.id) FILTER (WHERE b.id IS NOT NULL AND tb.bill_id IS NULL) AS untracked_count
    FROM subject_watches w
    LEFT JOIN bills b ON b.session_id = ${WORKING_SESSION_SQL} AND (
      EXISTS (
        SELECT 1 FROM draft_subjects ds JOIN subject_codes sc ON sc.id = ds.subject_code_id
        WHERE ds.draft_id = b.draft_id AND sc.code = ANY(w.subject_codes)
      )
      OR EXISTS (
        SELECT 1 FROM bill_tags bt WHERE bt.bill_id = b.id AND bt.tag_id = ANY(w.tag_ids)
      )
    )
    LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $1
    WHERE w.workspace_id = $1
    GROUP BY w.id, w.name, w.subject_codes, w.tag_ids, w.created_at
    ORDER BY w.created_at DESC
  `,
    [workspaceId],
  )

  if (rows.length === 0) return []

  const [{ rows: subjectRows }, { rows: tagRows }] = await Promise.all([
    pool.query<{ code: string; description: string }>('SELECT code, description FROM subject_codes'),
    pool.query<{ id: number; name: string }>('SELECT id, name FROM tags WHERE workspace_id = $1', [workspaceId]),
  ])
  const subjectByCode = new Map(subjectRows.map((r) => [r.code, r.description]))
  const tagById = new Map(tagRows.map((r) => [r.id, r.name]))

  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    subjectCodes: r.subject_codes.map((code) => ({ code, description: subjectByCode.get(code) ?? code })),
    tags: r.tag_ids.map((id) => ({ id: String(id), name: tagById.get(id) ?? `#${id}` })),
    matchCount: Number(r.match_count),
    untrackedCount: Number(r.untracked_count),
    createdAt: r.created_at,
  }))
}

export async function getSubjectWatchBills(watchId: number, workspaceId: number) {
  const { rows: watchRows } = await pool.query<{ subject_codes: string[]; tag_ids: number[] }>(
    'SELECT subject_codes, tag_ids FROM subject_watches WHERE id = $1 AND workspace_id = $2',
    [watchId, workspaceId],
  )
  const watch = watchRows[0]
  if (!watch) return null

  const { rows } = await pool.query<{
    bill_id: number
    bill_type_code: string | null
    bill_number: number | null
    draft_number: string
    short_title: string
    sponsor_first_name: string | null
    sponsor_last_name: string | null
    sponsor_party: string | null
    status_name: string | null
    is_tracked: boolean
    matched_subjects: string[] | null
    subject_count: number
  }>(
    `
    SELECT
      b.id AS bill_id, bt.code AS bill_type_code, b.bill_number, d.draft_number, d.short_title,
      sp.first_name AS sponsor_first_name, sp.last_name AS sponsor_last_name, pp.code AS sponsor_party,
      latest_status.status_name,
      (tb.bill_id IS NOT NULL) AS is_tracked,
      matched.matched_subjects,
      coalesce(subject_totals.total, 0) AS subject_count
    FROM bills b
    JOIN drafts d ON d.id = b.draft_id
    LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
    LEFT JOIN legislators sp ON sp.id = b.sponsor_id
    LEFT JOIN political_parties pp ON pp.id = sp.political_party_id
    LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $3
    LEFT JOIN LATERAL (
      SELECT bsc.name AS status_name, bs.occurred_at
      FROM bill_statuses bs
      LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
      WHERE bs.draft_id = d.id
      ORDER BY bs.occurred_at DESC
      LIMIT 1
    ) latest_status ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(sc.description ORDER BY sc.description) AS matched_subjects
      FROM draft_subjects ds JOIN subject_codes sc ON sc.id = ds.subject_code_id
      WHERE ds.draft_id = d.id AND sc.code = ANY($1)
    ) matched ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total FROM draft_subjects ds WHERE ds.draft_id = d.id
    ) subject_totals ON true
    WHERE b.session_id = ${WORKING_SESSION_SQL}
    AND (
      EXISTS (
        SELECT 1 FROM draft_subjects ds JOIN subject_codes sc ON sc.id = ds.subject_code_id
        WHERE ds.draft_id = d.id AND sc.code = ANY($1)
      )
      OR EXISTS (
        SELECT 1 FROM bill_tags bt2 WHERE bt2.bill_id = b.id AND bt2.tag_id = ANY($2)
      )
    )
    -- Montana's subject-code data has no real "primary topic" signal (see
    -- the comment in getBills()), so a bill tagged with just one or two
    -- subjects overall is a much stronger sign that a matched subject is
    -- actually central to it than one carrying a dozen tags. Rank the
    -- most focused matches first instead of by bare bill number, which
    -- otherwise surfaces bills like a low-numbered resolution that only
    -- tangentially touches the watched subject.
    ORDER BY subject_count ASC, b.bill_number NULLS LAST, d.draft_number
    `,
    [watch.subject_codes, watch.tag_ids, workspaceId],
  )

  return rows.map((r) => ({
    id: String(r.bill_id),
    identifier: formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number),
    title: r.short_title,
    sponsor: legislatorLabel(r.sponsor_first_name, r.sponsor_last_name),
    party: r.sponsor_party,
    status: r.status_name ?? 'Unknown',
    isTracked: r.is_tracked,
    matchedSubjects: r.matched_subjects ?? [],
    subjectCount: Number(r.subject_count),
  }))
}

// --- Interim committees ----------------------------------------------------
// Unlike standing committees (session-scoped, tied to bills), non-standing
// ("interim") committees run year-round between sessions on study topics, not
// specific bills — this is what makes the app useful in the off-season. The
// data's been scraped since early on (committees.legmt.gov) but never had a
// page; this is that page, plus a follow list so specific committees can
// surface on the dashboard without wading through all 36 every time.
// Committees themselves are global; is_followed/followed_committees are
// scoped to the calling workspace.

type AgendaItem = { id: number; title: string; description: string; orderNumber: number }

export async function getNonStandingCommittees(workspaceId: number) {
  const { rows } = await pool.query<{
    id: number
    name: string
    committee_type: string | null
    member_count: string
    next_meeting_at: string | null
    is_followed: boolean
  }>(
    `
    SELECT
      nsc.id, nsc.name, nsc.committee_type,
      count(DISTINCT nscm.legislator_id) AS member_count,
      min(m.meeting_time) FILTER (WHERE m.meeting_time >= now()) AS next_meeting_at,
      (fc.committee_id IS NOT NULL) AS is_followed
    FROM non_standing_committees nsc
    LEFT JOIN non_standing_committee_memberships nscm ON nscm.committee_id = nsc.id
    LEFT JOIN non_standing_committee_meetings m ON m.non_standing_committee_id = nsc.id
    LEFT JOIN followed_committees fc ON fc.committee_id = nsc.id AND fc.workspace_id = $1
    GROUP BY nsc.id, nsc.name, nsc.committee_type, fc.committee_id
    ORDER BY nsc.name
  `,
    [workspaceId],
  )

  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    committeeType: r.committee_type,
    memberCount: Number(r.member_count),
    nextMeetingAt: r.next_meeting_at,
    isFollowed: r.is_followed,
  }))
}

export async function getNonStandingCommitteeDetail(committeeId: number, workspaceId: number) {
  const { rows: coreRows } = await pool.query<{
    id: number
    name: string
    committee_type: string | null
    is_followed: boolean
  }>(
    `SELECT nsc.id, nsc.name, nsc.committee_type, (fc.committee_id IS NOT NULL) AS is_followed
     FROM non_standing_committees nsc
     LEFT JOIN followed_committees fc ON fc.committee_id = nsc.id AND fc.workspace_id = $2
     WHERE nsc.id = $1`,
    [committeeId, workspaceId],
  )
  const core = coreRows[0]
  if (!core) return null

  const [{ rows: memberRows }, { rows: meetingRows }, { rows: materialsRows }, { rows: recordingRows }] = await Promise.all([
    pool.query<{
      legislator_id: number | null
      first_name: string | null
      last_name: string | null
      party: string | null
      role_name: string | null
    }>(
      `SELECT l.id AS legislator_id, l.first_name, l.last_name, pp.code AS party, nscm.role_name
       FROM non_standing_committee_memberships nscm
       LEFT JOIN legislators l ON l.id = nscm.legislator_id
       LEFT JOIN political_parties pp ON pp.id = l.political_party_id
       WHERE nscm.committee_id = $1
       ORDER BY (nscm.role_name IS NULL), nscm.role_name, l.last_name NULLS LAST`,
      [committeeId],
    ),
    pool.query<{
      id: number
      meeting_time: string | null
      meeting_end_time: string | null
      location: string | null
      comments: string | null
      public_participation: boolean | null
      status: string | null
      agenda_items: AgendaItem[] | null
    }>(
      `SELECT id, meeting_time, meeting_end_time, location, comments, public_participation, status, agenda_items
       FROM non_standing_committee_meetings
       WHERE non_standing_committee_id = $1
       ORDER BY meeting_time DESC`,
      [committeeId],
    ),
    pool.query<{ content_html: string }>(
      `SELECT content_html FROM non_standing_committee_materials
       WHERE committee_id = $1 AND tab_title = 'Meeting Materials'`,
      [committeeId],
    ),
    // The recordings of the meetings. A recording without a meeting id goes
    // to the meeting of the committee on the same day, the nearest in time.
    pool.query<RecordingRow & { matched_meeting_id: number | null }>(
      `SELECT ${RECORDING_COLUMNS},
              coalesce(r.meeting_id, (
                SELECT sm.id FROM non_standing_committee_meetings sm
                WHERE sm.non_standing_committee_id = r.committee_id
                  AND sm.meeting_time::date = r.recorded_at::date
                ORDER BY abs(extract(epoch FROM sm.meeting_time - r.recorded_at))
                LIMIT 1
              )) AS matched_meeting_id
       FROM hearing_recordings r
       ${RECORDING_JOINS}
       WHERE r.committee_id = $2
       ORDER BY r.recorded_at`,
      [workspaceId, committeeId],
    ),
  ])

  const recordingsByMeeting = new Map<number, ReturnType<typeof recordingSummary>[]>()
  for (const r of recordingRows) {
    if (r.matched_meeting_id == null) continue
    const list = recordingsByMeeting.get(r.matched_meeting_id) ?? []
    list.push(recordingSummary(r))
    recordingsByMeeting.set(r.matched_meeting_id, list)
  }

  return {
    id: String(core.id),
    name: core.name,
    committeeType: core.committee_type,
    isFollowed: core.is_followed,
    archiveUrl: archiveSearchUrl(core.name),
    meetingMaterialsHtml: materialsRows[0]?.content_html ?? null,
    members: memberRows.map((r) => ({
      legislatorId: r.legislator_id != null ? String(r.legislator_id) : null,
      name: legislatorLabel(r.first_name, r.last_name),
      party: r.party,
      roleName: r.role_name,
    })),
    meetings: meetingRows.map((r) => ({
      id: String(r.id),
      meetingTime: r.meeting_time,
      meetingEndTime: r.meeting_end_time,
      location: r.location,
      comments: r.comments,
      publicParticipation: r.public_participation,
      status: r.status,
      agendaItems: (r.agenda_items ?? [])
        .slice()
        .sort((a, b) => a.orderNumber - b.orderNumber)
        .map((a) => ({ id: a.id, title: a.title, description: a.description })),
      recordings: recordingsByMeeting.get(r.id) ?? [],
    })),
  }
}

export async function getFollowedCommittees(workspaceId: number) {
  const { rows } = await pool.query<{
    id: number
    name: string
    next_meeting_at: string | null
    next_location: string | null
  }>(
    `
    SELECT
      nsc.id, nsc.name,
      min(m.meeting_time) FILTER (WHERE m.meeting_time >= now()) AS next_meeting_at,
      (
        SELECT m2.location FROM non_standing_committee_meetings m2
        WHERE m2.non_standing_committee_id = nsc.id AND m2.meeting_time >= now()
        ORDER BY m2.meeting_time ASC LIMIT 1
      ) AS next_location
    FROM followed_committees fc
    JOIN non_standing_committees nsc ON nsc.id = fc.committee_id
    LEFT JOIN non_standing_committee_meetings m ON m.non_standing_committee_id = nsc.id
    WHERE fc.workspace_id = $1
    GROUP BY nsc.id, nsc.name
    ORDER BY (min(m.meeting_time) FILTER (WHERE m.meeting_time >= now()) IS NULL),
             min(m.meeting_time) FILTER (WHERE m.meeting_time >= now()),
             nsc.name
  `,
    [workspaceId],
  )

  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    nextMeetingAt: r.next_meeting_at,
    nextLocation: r.next_location,
  }))
}

// --- Testimony -------------------------------------------------------------
// The actual written/oral statements submitted to a committee for a bill's
// hearing — a workflow with a real lifecycle (draft -> submitted ->
// delivered), unlike notes which are just an append-only log. Optionally
// tied to a specific committee_meetings row (nullable: testimony can be
// drafted before a hearing date exists yet).

type TestimonyRow = {
  id: number
  bill_id: number
  bill_type_code: string | null
  bill_number: number | null
  draft_number: string
  short_title: string
  committee_meeting_id: number | null
  committee_name: string | null
  meeting_time: string | null
  author_id: number | null
  author_name: string | null
  position: string | null
  status: string
  body: string
  attachment_filename: string | null
  created_at: string
  updated_at: string
}

function shapeTestimony(r: TestimonyRow) {
  return {
    id: String(r.id),
    billId: String(r.bill_id),
    billIdentifier: formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number),
    billTitle: r.short_title,
    committeeMeetingId: r.committee_meeting_id != null ? String(r.committee_meeting_id) : null,
    committeeName: r.committee_name,
    hearingTime: r.meeting_time,
    authorId: r.author_id != null ? String(r.author_id) : null,
    authorName: r.author_name,
    position: r.position as 'support' | 'oppose' | 'watch' | 'neutral' | null,
    status: r.status as 'draft' | 'submitted' | 'delivered',
    body: r.body,
    attachmentFilename: r.attachment_filename,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const TESTIMONY_SELECT = `
  SELECT t.id, t.bill_id, bt.code AS bill_type_code, b.bill_number, d.draft_number, d.short_title,
         t.committee_meeting_id, sc.name AS committee_name, cm.meeting_time,
         t.author_id, u.name AS author_name, t.position, t.status, t.body, t.attachment_filename,
         t.created_at, t.updated_at
  FROM testimony t
  JOIN bills b ON b.id = t.bill_id
  JOIN drafts d ON d.id = b.draft_id
  LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
  LEFT JOIN committee_meetings cm ON cm.id = t.committee_meeting_id
  LEFT JOIN standing_committees sc ON sc.id = cm.standing_committee_id
  LEFT JOIN users u ON u.id = t.author_id
`

export async function getTestimony(workspaceId: number) {
  const { rows } = await pool.query<TestimonyRow>(
    `${TESTIMONY_SELECT} WHERE t.workspace_id = $1 ORDER BY (cm.meeting_time IS NULL), cm.meeting_time ASC, t.created_at DESC`,
    [workspaceId],
  )
  return rows.map(shapeTestimony)
}

export async function getBillTestimony(billId: number, workspaceId: number) {
  const { rows } = await pool.query<TestimonyRow>(
    `${TESTIMONY_SELECT} WHERE t.workspace_id = $1 AND t.bill_id = $2 ORDER BY t.created_at DESC`,
    [workspaceId, billId],
  )
  return rows.map(shapeTestimony)
}

export async function getTestimonyAttachment(id: number, workspaceId: number) {
  const { rows } = await pool.query<{ attachment_filename: string | null; attachment_mime_type: string | null; attachment_data: Buffer | null }>(
    'SELECT attachment_filename, attachment_mime_type, attachment_data FROM testimony WHERE id = $1 AND workspace_id = $2',
    [id, workspaceId],
  )
  const row = rows[0]
  if (!row || !row.attachment_data) return null
  return {
    filename: row.attachment_filename ?? 'testimony',
    mimeType: row.attachment_mime_type ?? 'application/octet-stream',
    data: row.attachment_data,
  }
}

// ---------------------------------------------------------------------------
// Change alerts (see server/src/alerts.ts): the current user's delivery mode
// plus an on/off switch for each source of alerts in this workspace.

export async function getNotificationPreferences(userId: number, workspaceId: number) {
  const [{ rows: prefRows }, { rows: muteRows }, { rows: watchRows }, { rows: committeeRows }] = await Promise.all([
    pool.query<{ delivery: string; hearing_reminder_hours: number[] }>(
      'SELECT delivery, hearing_reminder_hours FROM notification_preferences WHERE user_id = $1',
      [userId],
    ),
    pool.query<{ watch_type: string; watch_id: number }>(
      'SELECT watch_type, watch_id FROM alert_mutes WHERE user_id = $1 AND workspace_id = $2',
      [userId, workspaceId],
    ),
    pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM subject_watches WHERE workspace_id = $1 ORDER BY name',
      [workspaceId],
    ),
    pool.query<{ id: number; name: string }>(
      `SELECT nsc.id, nsc.name FROM followed_committees fc
       JOIN non_standing_committees nsc ON nsc.id = fc.committee_id
       WHERE fc.workspace_id = $1 ORDER BY nsc.name`,
      [workspaceId],
    ),
  ])
  const muted = new Set(muteRows.map((m) => `${m.watch_type}:${m.watch_id}`))
  return {
    delivery: (prefRows[0]?.delivery ?? 'immediate') as 'immediate' | 'daily' | 'off',
    hearingReminderHours: prefRows[0]?.hearing_reminder_hours ?? [24],
    trackedBills: !muted.has('tracked_bills:0'),
    subjectWatches: watchRows.map((w) => ({ id: String(w.id), name: w.name, enabled: !muted.has(`subject_watch:${w.id}`) })),
    followedCommittees: committeeRows.map((c) => ({
      id: String(c.id),
      name: c.name,
      enabled: !muted.has(`followed_committee:${c.id}`),
    })),
  }
}

// All the values for the dashboard filter menus, not only the values of
// the tracked bills. Each value has the same format as in getBills().
export async function getFilterOptions() {
  const [statuses, subjects, committees, sponsors, parties] = await Promise.all([
    pool.query<{ v: string }>(
      `SELECT DISTINCT bsc.name AS v FROM bill_statuses bs JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
       WHERE bsc.name IS NOT NULL ORDER BY 1`,
    ),
    pool.query<{ v: string }>(`SELECT DISTINCT description AS v FROM subject_codes WHERE description IS NOT NULL ORDER BY 1`),
    pool.query<{ v: string }>(`SELECT DISTINCT name AS v FROM standing_committees WHERE name IS NOT NULL ORDER BY 1`),
    pool.query<{ v: string }>(
      `SELECT DISTINCT trim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')) AS v
       FROM bills b JOIN legislators sp ON sp.id = b.sponsor_id
       WHERE sp.first_name IS NOT NULL OR sp.last_name IS NOT NULL ORDER BY 1`,
    ),
    pool.query<{ v: string }>(`SELECT DISTINCT code AS v FROM political_parties WHERE code IS NOT NULL ORDER BY 1`),
  ])
  const values = (r: { rows: { v: string }[] }) => r.rows.map((row) => row.v).filter(Boolean)
  return {
    statuses: values(statuses),
    subjects: values(subjects),
    committees: values(committees),
    sponsors: values(sponsors),
    parties: values(parties),
  }
}

// The dashboard calendar: the hearings of the tracked bills and the meetings
// of the followed committees, from the date "from" to the date "to" (both
// included). One hearing event is one committee meeting. Each event lists
// the tracked bills on its agenda. The times are naive Montana times.
export async function getCalendar(workspaceId: number, from: string, to: string) {
  const [{ rows: hearings }, { rows: meetings }, patterns, { rows: tracked }] = await Promise.all([
    pool.query<{
      meeting_id: number
      committee: string | null
      meeting_time: string
      location: string | null
      bills: { id: number; type: string | null; number: number | null; draft: string; title: string | null }[]
    }>(
      `SELECT cm.id AS meeting_id, sc.name AS committee, cm.meeting_time, cm.location,
              json_agg(json_build_object('id', b.id, 'type', bt.code, 'number', b.bill_number,
                                         'draft', d.draft_number, 'title', d.short_title)
                       ORDER BY bt.code, b.bill_number, d.draft_number) AS bills
       FROM committee_bill_hearings cbh
       JOIN committee_meetings cm ON cm.id = cbh.committee_meeting_id
       LEFT JOIN standing_committees sc ON sc.id = cm.standing_committee_id
       JOIN tracked_bills tb ON tb.bill_id = cbh.bill_id AND tb.workspace_id = $1
       JOIN bills b ON b.id = cbh.bill_id
       JOIN drafts d ON d.id = b.draft_id
       LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
       WHERE cm.meeting_time >= $2::date AND cm.meeting_time < $3::date + 1
         AND coalesce(cm.status, '') <> 'CANCELED' AND coalesce(cbh.status, '') <> 'CANCELED'
         AND cbh.removed_at IS NULL
       GROUP BY cm.id, sc.name
       ORDER BY cm.meeting_time`,
      [workspaceId, from, to],
    ),
    pool.query<{
      id: number
      committee_id: number
      committee: string
      meeting_time: string
      meeting_end_time: string | null
      location: string | null
      agenda_items: { title?: string | null; description?: string | null }[] | null
    }>(
      `SELECT m.id, nsc.id AS committee_id, nsc.name AS committee, m.meeting_time, m.meeting_end_time, m.location,
              m.agenda_items
       FROM non_standing_committee_meetings m
       JOIN non_standing_committees nsc ON nsc.id = m.non_standing_committee_id
       JOIN followed_committees fc ON fc.committee_id = nsc.id AND fc.workspace_id = $1
       WHERE m.meeting_time >= $2::date AND m.meeting_time < $3::date + 1
         AND coalesce(m.status, '') <> 'CANCELED'
       ORDER BY m.meeting_time`,
      [workspaceId, from, to],
    ),
    // An interim committee agenda names bills only in its text.
    trackedBillPatterns(workspaceId),
    pool.query<{ id: number; type: string | null; number: number | null; draft: string; title: string | null }>(
      `SELECT b.id, bt.code AS type, b.bill_number AS number, d.draft_number AS draft, d.short_title AS title
       FROM tracked_bills tb
       JOIN bills b ON b.id = tb.bill_id
       JOIN drafts d ON d.id = b.draft_id
       LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
       WHERE tb.workspace_id = $1`,
      [workspaceId],
    ),
  ])
  const trackedById = new Map(
    tracked.map((b) => [String(b.id), { id: String(b.id), identifier: formatIdentifier(b.type, b.number, b.draft), title: b.title }]),
  )
  const agendaBills = (agenda: { title?: string | null; description?: string | null }[] | null) => {
    const text = (agenda ?? []).map((a) => `${a.title ?? ''} ${a.description ?? ''}`).join('\n')
    return patterns.filter((p) => p.pattern.test(text)).flatMap((p) => trackedById.get(p.billId) ?? [])
  }
  const events = [
    ...hearings.map((h) => ({
      id: `hearing-${h.meeting_id}`,
      kind: 'hearing' as const,
      title: h.committee ? `${h.committee} hearing` : 'Committee hearing',
      start: h.meeting_time,
      end: null,
      location: h.location,
      committeeId: null,
      bills: h.bills.map((b) => ({ id: String(b.id), identifier: formatIdentifier(b.type, b.number, b.draft), title: b.title })),
    })),
    ...meetings.map((m) => ({
      id: `meeting-${m.id}`,
      kind: 'meeting' as const,
      title: m.committee,
      start: m.meeting_time,
      end: m.meeting_end_time,
      location: m.location,
      committeeId: String(m.committee_id),
      bills: agendaBills(m.agenda_items),
    })),
  ]
  return { events: events.sort((a, b) => a.start.localeCompare(b.start)) }
}

// LC drafts to suggest for tracking: the newest open drafts of a session that
// has not ended, that match a subject watch, and that the workspace does not
// track. With no match, the newest open drafts statewide ("source" tells
// which). A draft whose latest status is final (code 5, for example "Draft
// Died in Process") is not open.
export async function getSuggestedBills(workspaceId: number, limit: number) {
  const { rows: watchRows } = await pool.query<{ codes: string[] | null }>(
    `SELECT array_agg(DISTINCT code) AS codes FROM subject_watches w, unnest(w.subject_codes) AS code WHERE w.workspace_id = $1`,
    [workspaceId],
  )
  const codes = watchRows[0]?.codes ?? []
  const query = (matchWatches: boolean) =>
    pool.query<{
      bill_id: number
      draft_number: string
      short_title: string
      requester: string | null
      subject: string | null
    }>(
      `SELECT b.id AS bill_id, d.draft_number, d.short_title,
              CASE d.requester_type
                WHEN 'LEGISLATOR' THEN (SELECT trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) FROM legislators l WHERE l.id = d.requester_id)
                WHEN 'NON_STANDING_COMMITTEE' THEN (SELECT name FROM non_standing_committees WHERE id = d.requester_id)
                WHEN 'AGENCY' THEN 'An agency'
              END AS requester,
              (SELECT sc.description FROM draft_subjects ds JOIN subject_codes sc ON sc.id = ds.subject_code_id
               WHERE ds.draft_id = d.id ${matchWatches ? 'AND sc.code = ANY($3)' : ''}
               ORDER BY ds.is_primary DESC NULLS LAST, sc.description LIMIT 1) AS subject
       FROM bills b
       JOIN drafts d ON d.id = b.draft_id
       JOIN sessions s ON s.id = b.session_id
       WHERE (s.sine_die_date IS NULL OR s.sine_die_date > now())
         AND b.bill_number IS NULL
         AND NOT EXISTS (SELECT 1 FROM tracked_bills tb WHERE tb.bill_id = b.id AND tb.workspace_id = $1)
         AND coalesce((SELECT pc.code FROM bill_statuses bs JOIN progress_categories pc ON pc.id = bs.progress_category_id
                       WHERE bs.draft_id = d.id ORDER BY bs.occurred_at DESC LIMIT 1), 0) <> 5
         ${
           matchWatches
             ? `AND EXISTS (SELECT 1 FROM draft_subjects ds JOIN subject_codes sc ON sc.id = ds.subject_code_id
                            WHERE ds.draft_id = d.id AND sc.code = ANY($3))`
             : ''
         }
       ORDER BY d.drafted_at DESC NULLS LAST, b.id DESC
       LIMIT $2`,
      matchWatches ? [workspaceId, limit, codes] : [workspaceId, limit],
    )
  let source: 'watches' | 'statewide' = 'watches'
  let { rows } = codes.length > 0 ? await query(true) : { rows: [] }
  if (rows.length === 0) {
    source = 'statewide'
    rows = (await query(false)).rows
  }
  return {
    source,
    hasWatches: codes.length > 0,
    bills: rows.map((r) => ({
      id: String(r.bill_id),
      identifier: formatIdentifier(null, null, r.draft_number),
      title: r.short_title,
      requester: r.requester,
      subject: r.subject,
    })),
  }
}

// The legislators map: the counties with their districts
// (src/data/montanaCountyDistricts.json, made by scripts/buildCountyDistricts.mjs)
// and the current member of each district.
const countyDistricts = JSON.parse(
  readFileSync(new URL('../data/montanaCountyDistricts.json', import.meta.url), 'utf8'),
) as {
  counties: { fips: string; name: string; house: number[]; senate: number[] }[]
  /** The counties of each district, the county with the largest part first. */
  districts: { house: Record<string, string[]>; senate: Record<string, string[]> }
}

export async function getLegislatorMap(workspaceId: number) {
  const { rows } = await pool.query<{
    id: number
    first_name: string | null
    last_name: string | null
    chamber: string
    district: number
    party: string | null
    email: string | null
    home_county: string | null
    committees: string[] | null
    tracked: string
  }>(
    `WITH serving AS (
       -- The legislature of the latest session that has started.
       SELECT legislature_id FROM sessions WHERE start_date <= now() ORDER BY start_date DESC LIMIT 1
     ),
     current AS (
       -- The current member of each district: a term that has started and
       -- not ended. When two terms are current (a member and the nominee for
       -- the next legislature), the serving legislature comes first.
       SELECT DISTINCT ON (d.chamber, d.number) l.*, d.chamber AS district_chamber, d.number AS district_number
       FROM legislators l
       JOIN districts d ON d.id = l.district_id
       WHERE d.number BETWEEN 1 AND 100
         AND ${realLegislatorSql('l')}
         AND (l.start_date IS NULL OR l.start_date <= now())
         AND (l.end_date IS NULL OR l.end_date >= now())
       ORDER BY d.chamber, d.number, (l.legislature_id = (SELECT legislature_id FROM serving)) DESC, l.start_date DESC NULLS LAST
     )
     SELECT c.id, c.first_name, c.last_name, upper(c.district_chamber) AS chamber, c.district_number AS district,
            pp.code AS party, c.email_address AS email, c.home_county,
            -- The standing committees only: not the Committee of the Whole or the
            -- conference committees of single bills. Without the "(H)" or "(S)" prefix.
            (SELECT array_agg(DISTINCT regexp_replace(sc.name, '^\\([HS]\\)\\s*', '') ORDER BY regexp_replace(sc.name, '^\\([HS]\\)\\s*', ''))
             FROM committee_memberships cm JOIN standing_committees sc ON sc.id = cm.committee_id
             WHERE cm.legislator_id = c.id
               AND sc.name NOT ILIKE '%Committee of the Whole%'
               AND sc.name NOT ILIKE '%Conference Committee%'
               AND sc.session_id = (SELECT session_id FROM standing_committees GROUP BY session_id ORDER BY session_id DESC LIMIT 1)
            ) AS committees,
            (SELECT count(*) FROM tracked_bills tb JOIN bills b ON b.id = tb.bill_id
             WHERE tb.workspace_id = $1 AND b.sponsor_id = c.id) AS tracked
     FROM current c
     LEFT JOIN political_parties pp ON pp.id = c.political_party_id`,
    [workspaceId],
  )
  return {
    counties: countyDistricts.counties,
    districts: countyDistricts.districts,
    members: rows.map((r) => ({
      id: String(r.id),
      name: legislatorLabel(r.first_name, r.last_name),
      initials: `${(r.first_name ?? '').charAt(0)}${(r.last_name ?? '').charAt(0)}`.toUpperCase(),
      chamber: r.chamber === 'SENATE' ? ('senate' as const) : ('house' as const),
      district: r.district,
      party: r.party,
      email: r.email,
      homeCounty: r.home_county,
      committees: r.committees ?? [],
      trackedSponsored: Number(r.tracked),
    })),
  }
}

// ---------------------------------------------------------------- search

const SEARCH_LIMIT = 6

// "HB 2", "hb2", "LC 82", "lc0082": a bill type or "LC" and a number.
const IDENTIFIER_QUERY = /^\s*([a-z]{2})\s*0*(\d{1,4})\s*$/i

/**
 * The search of the command palette: bills and LC drafts of all sessions,
 * current legislators, interim committees, and hearing recordings.
 */
export async function search(workspaceId: number, rawQuery: string) {
  const q = rawQuery.trim().slice(0, 100)
  if (q.length < 2) return { bills: [], legislators: [], committees: [], hearings: [] }
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const id = IDENTIFIER_QUERY.exec(q)
  const prefix = id ? id[1].toUpperCase() : null
  const number = id ? Number(id[2]) : null

  const [billRows, legislatorRows, committeeRows, hearingRows] = await Promise.all([
    pool.query<{
      id: number
      bill_type_code: string | null
      bill_number: number | null
      draft_number: string
      short_title: string
      ordinals: string
      is_tracked: boolean
    }>(
      // An identifier match comes first, then the newest session.
      `SELECT b.id, bt.code AS bill_type_code, b.bill_number, d.draft_number, d.short_title, s.ordinals,
              (tb.bill_id IS NOT NULL) AS is_tracked
       FROM bills b
       JOIN drafts d ON d.id = b.draft_id
       JOIN sessions s ON s.id = b.session_id
       LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
       LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $1
       WHERE d.short_title ILIKE $2
          OR ($3::text = 'LC' AND (CASE WHEN d.draft_number ~ '^LC[0-9]+$' THEN substring(d.draft_number FROM 3)::int END) = $4)
          OR (bt.code = $3 AND b.bill_number = $4)
       ORDER BY coalesce((bt.code = $3 AND b.bill_number = $4)
                 OR ($3::text = 'LC' AND (CASE WHEN d.draft_number ~ '^LC[0-9]+$' THEN substring(d.draft_number FROM 3)::int END) = $4), false) DESC,
                s.start_date DESC NULLS LAST, b.bill_number NULLS LAST, d.draft_number
       LIMIT ${SEARCH_LIMIT}`,
      [workspaceId, like, prefix, number],
    ),
    pool.query<{ id: number; first_name: string | null; last_name: string | null; chamber: string | null; district: string | null; party: string | null }>(
      // The newest record of each person, by name or district ("House District 28").
      `SELECT DISTINCT ON (l.first_name, l.last_name) l.id, l.first_name, l.last_name, l.chamber,
              dist.name AS district, pp.code AS party
       FROM legislators l
       LEFT JOIN districts dist ON dist.id = l.district_id
       LEFT JOIN political_parties pp ON pp.id = l.political_party_id
       WHERE ${realLegislatorSql('l')}
         AND (trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) ILIKE $1 OR dist.name ILIKE $1)
       ORDER BY l.first_name, l.last_name, l.legislature_id DESC
       LIMIT ${SEARCH_LIMIT}`,
      [like],
    ),
    pool.query<{ id: number; name: string; committee_type: string | null }>(
      // The committees of the newest legislature only, so a committee shows one time.
      `SELECT nsc.id, nsc.name, nsc.committee_type
       FROM non_standing_committees nsc
       WHERE nsc.name ILIKE $1
         AND nsc.legislature_id = (SELECT max(legislature_id) FROM non_standing_committees)
       ORDER BY nsc.name
       LIMIT ${SEARCH_LIMIT}`,
      [like],
    ),
    pool.query<{ id: number; committee_name: string; recorded_at: string }>(
      `SELECT r.id, r.committee_name, r.recorded_at
       FROM hearing_recordings r
       WHERE r.committee_name ILIKE $1 OR r.title ILIKE $1
       ORDER BY r.recorded_at DESC
       LIMIT ${SEARCH_LIMIT}`,
      [like],
    ),
  ])

  return {
    bills: billRows.rows.map((r) => ({
      id: String(r.id),
      identifier: formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number),
      title: r.short_title,
      session: r.ordinals.slice(0, 4),
      isTracked: r.is_tracked,
    })),
    legislators: legislatorRows.rows.map((r) => ({
      id: String(r.id),
      name: legislatorLabel(r.first_name, r.last_name),
      detail: [r.district, r.party].filter(Boolean).join(' · '),
    })),
    committees: committeeRows.rows.map((r) => ({ id: String(r.id), name: r.name, detail: r.committee_type ?? '' })),
    hearings: hearingRows.rows.map((r) => ({ id: String(r.id), committee: r.committee_name, recordedAt: r.recorded_at })),
  }
}
