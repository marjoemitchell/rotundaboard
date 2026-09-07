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
import { pool } from '../db.js'
import { computeMomentum, type StatusPoint } from '../momentum.js'

function formatIdentifier(billTypeCode: string | null, billNumber: number | null, draftNumber: string): string {
  if (billTypeCode && billNumber != null) return `${billTypeCode} ${billNumber}`
  // "LC0412" -> "LC 0412"
  const match = draftNumber.match(/^([A-Za-z]+)(\d+)$/)
  return match ? `${match[1]} ${match[2]}` : draftNumber
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
    sponsor_first_name: string | null
    sponsor_last_name: string | null
    sponsor_district: string | null
    sponsor_party: string | null
    subject: string | null
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
      sp.first_name AS sponsor_first_name,
      sp.last_name AS sponsor_last_name,
      dist.name AS sponsor_district,
      pp.code AS sponsor_party,
      subj.description AS subject,
      latest_committee.committee_name,
      latest_status.status_name,
      latest_status.occurred_at AS status_occurred_at,
      tb.position,
      tb.assignee_id
    FROM tracked_bills tb
    JOIN bills b ON b.id = tb.bill_id
    JOIN drafts d ON d.id = b.draft_id
    LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
    LEFT JOIN legislators sp ON sp.id = b.sponsor_id
    LEFT JOIN districts dist ON dist.id = sp.district_id
    LEFT JOIN political_parties pp ON pp.id = sp.political_party_id
    LEFT JOIN LATERAL (
      SELECT subj.description
      FROM draft_subjects ds
      JOIN subject_codes subj ON subj.id = ds.subject_code_id
      WHERE ds.draft_id = d.id AND ds.is_primary = true
      ORDER BY ds.subject_code_id
      LIMIT 1
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

  return rows.map((r) => {
    const sponsorName = r.sponsor_first_name || r.sponsor_last_name ? `${r.sponsor_first_name ?? ''} ${r.sponsor_last_name ?? ''}`.trim() : ''
    const statuses = statusesByBill.get(r.bill_id) ?? []
    const momentum = computeMomentum(statuses, activityDatesByBill.get(r.bill_id) ?? [])

    return {
      id: String(r.bill_id),
      identifier: formatIdentifier(r.bill_type_code, r.bill_number, r.draft_number),
      title: r.short_title,
      sponsor: { name: sponsorName, district: r.sponsor_district ?? '', party: r.sponsor_party ?? '' },
      committee: r.committee_name ?? undefined,
      chamber: r.chamber ? (r.chamber.toLowerCase() as 'house' | 'senate') : undefined,
      subject: r.subject ?? undefined,
      status: r.status_name ?? 'Unknown',
      lastAction: {
        text: r.status_name ?? 'No recorded action',
        date: r.status_occurred_at ?? new Date().toISOString(),
      },
      position: r.position as 'support' | 'oppose' | 'watch' | 'neutral' | null,
      assigneeId: r.assignee_id != null ? String(r.assignee_id) : null,
      momentum,
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
  const { rows: legislatorRows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM legislators')
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
  const { rows: digestRows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM digests WHERE workspace_id = $1', [
    workspaceId,
  ])

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
    digests: Number(digestRows[0]?.n ?? 0),
  }
}

export async function getSessionCalendar() {
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
         count(*) FILTER (WHERE d.drafted_at >= now() - interval '7 days') AS recent
       FROM drafts d WHERE d.session_id = $1`,
      [nextSession.id],
    )
    lcDraftsFiled = Number(rows[0]?.total ?? 0)
    lcDraftsDelta7d = Number(rows[0]?.recent ?? 0)
  }

  const { rows: hearingRows } = await pool.query<{ n: string; committees: string[] }>(
    `SELECT count(*) AS n, coalesce(array_agg(DISTINCT nsc.name), '{}') AS committees
     FROM non_standing_committee_meetings m
     JOIN non_standing_committees nsc ON nsc.id = m.non_standing_committee_id
     WHERE m.meeting_time BETWEEN now() AND now() + interval '30 days'`,
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
    daysToTransmittal: null,
    transmittalDate: null,
  }
}

// Rule-based digest computed from real momentum deltas, untriaged bills, and
// the next scheduled interim hearing — no LLM call involved. The frontend
// label for this panel is "Morning brief" (not "AI-generated"), so this is
// an honest match, not a stand-in for something more sophisticated later.
export async function getBrief(workspaceId: number) {
  const [bills, hearings, activityCount] = await Promise.all([
    getBills(workspaceId),
    getHearings(),
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
  if (summaryParts.length === 0) {
    summaryParts.push(
      'No tracked bills moved meaningfully in the last 7 days. The 2025 session concluded over a year ago, so most status history is long settled — momentum here mostly reflects how far each bill got, not recent activity.',
    )
  }
  if (hearings.length > 0) {
    const when = new Date(hearings[0].datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    summaryParts.push(`Next up on the interim calendar: **${hearings[0].committee}** on ${when}.`)
  }

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
      text: `${hearings[0].committee} meets ${when} — next interim hearing on the calendar.`,
      sourceIds: [],
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: summaryParts.join(' '),
    boldedBillIds,
    taggedItems,
    sourceCounts: {
      actions: Number(activityCount.rows[0]?.n ?? 0),
      hearings: hearings.length,
      fiscalNotes: 0,
    },
  }
}

export async function getHearings() {
  const { rows } = await pool.query<{
    id: number
    committee: string
    meeting_time: string
    meeting_end_time: string | null
    location: string | null
  }>(`
    SELECT m.id, nsc.name AS committee, m.meeting_time, m.meeting_end_time, m.location
    FROM non_standing_committee_meetings m
    JOIN non_standing_committees nsc ON nsc.id = m.non_standing_committee_id
    WHERE m.meeting_time >= now()
    ORDER BY m.meeting_time ASC
    LIMIT 5
  `)

  return rows.map((r) => {
    const start = new Date(r.meeting_time)
    const end = r.meeting_end_time ? new Date(r.meeting_end_time) : null
    const durationSeconds = end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)) : 0
    return {
      id: String(r.id),
      committee: r.committee,
      datetime: r.meeting_time,
      room: r.location ?? 'Room TBD',
      durationSeconds,
      // No recording/transcript pipeline exists yet — honest 'pending', not fabricated content.
      transcriptStatus: 'pending' as const,
      waveform: [] as number[],
      transcript: [] as { timestamp: number; speaker: string; text: string }[],
      trackedTermMentions: 0,
    }
  })
}

// Every future interim-committee meeting, across all committees — not just
// the ones a workspace follows. This is the "browse the full calendar" view
// the left-nav's Hearings item links to; getHearings() above stays scoped
// to the dashboard's single-hearing preview widget so that existing shape
// doesn't change under it. isFollowed is still overlaid per-workspace (same
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
    sponsor_first_name: string | null
    sponsor_last_name: string | null
    sponsor_district: string | null
    sponsor_party: string | null
    subject: string | null
    committee_name: string | null
    status_name: string | null
    status_occurred_at: string | null
    position: string | null
    assignee_id: number | null
    summary: string | null
    summary_model: string | null
    summary_generated_at: string | null
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
      sp.first_name AS sponsor_first_name,
      sp.last_name AS sponsor_last_name,
      dist.name AS sponsor_district,
      pp.code AS sponsor_party,
      subj.description AS subject,
      latest_committee.committee_name,
      latest_status.status_name,
      latest_status.occurred_at AS status_occurred_at,
      tb.position,
      tb.assignee_id,
      (tb.bill_id IS NOT NULL) AS is_tracked,
      bsum.summary,
      bsum.model AS summary_model,
      bsum.generated_at AS summary_generated_at
    FROM bills b
    JOIN drafts d ON d.id = b.draft_id
    LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $2
    LEFT JOIN bill_summaries bsum ON bsum.bill_id = b.id
    LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
    LEFT JOIN legislators sp ON sp.id = b.sponsor_id
    LEFT JOIN districts dist ON dist.id = sp.district_id
    LEFT JOIN political_parties pp ON pp.id = sp.political_party_id
    LEFT JOIN LATERAL (
      SELECT subj.description
      FROM draft_subjects ds
      JOIN subject_codes subj ON subj.id = ds.subject_code_id
      WHERE ds.draft_id = d.id AND ds.is_primary = true
      ORDER BY ds.subject_code_id
      LIMIT 1
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

  const [statusRows, statusHistoryRows, voteRows, executiveActionRows, cosponsorRows, hearingRows, amendmentRows] =
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
      pool.query<{ id: number; number: number | null; type: string | null; bill_version: number | null }>(
        `SELECT id, number, type, bill_version FROM amendments WHERE bill_id = $1 ORDER BY number ASC`,
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

  return {
    id: String(core.bill_id),
    identifier: formatIdentifier(core.bill_type_code, core.bill_number, core.draft_number),
    draftNumber: core.draft_number,
    title: core.short_title,
    sponsor: { name: sponsorName, district: core.sponsor_district ?? '', party: core.sponsor_party ?? '' },
    committee: core.committee_name ?? undefined,
    chamber: core.chamber ? (core.chamber.toLowerCase() as 'house' | 'senate') : undefined,
    subject: core.subject ?? undefined,
    status: core.status_name ?? 'Unknown',
    lastAction: {
      text: core.status_name ?? 'No recorded action',
      date: core.status_occurred_at ?? new Date().toISOString(),
    },
    position: core.position as 'support' | 'oppose' | 'watch' | 'neutral' | null,
    assigneeId: core.assignee_id != null ? String(core.assignee_id) : null,
    isTracked: core.is_tracked,
    aiSummary: core.summary
      ? { text: core.summary, model: core.summary_model, generatedAt: core.summary_generated_at }
      : null,
    momentum,
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
    })),
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
      count(b.id) AS bill_count,
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
    email_address: string | null
    legislature_ordinal: number | null
  }>(
    `SELECT l.id, l.first_name, l.last_name, l.chamber, pp.code AS party, dist.name AS district,
            l.email_address, leg.ordinal AS legislature_ordinal
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
    email: core.email_address,
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

const WORKING_SESSION_SQL = `(SELECT id FROM sessions WHERE id IN (SELECT DISTINCT session_id FROM bills) ORDER BY start_date DESC LIMIT 1)`

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
    LEFT JOIN tracked_bills tb ON tb.bill_id = b.id AND tb.workspace_id = $3
    LEFT JOIN LATERAL (
      SELECT bsc.name AS status_name, bs.occurred_at
      FROM bill_statuses bs
      LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
      WHERE bs.draft_id = d.id
      ORDER BY bs.occurred_at DESC
      LIMIT 1
    ) latest_status ON true
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
    ORDER BY b.bill_number NULLS LAST, d.draft_number
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

  const [{ rows: memberRows }, { rows: meetingRows }] = await Promise.all([
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
  ])

  return {
    id: String(core.id),
    name: core.name,
    committeeType: core.committee_type,
    isFollowed: core.is_followed,
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

// --- Digests -----------------------------------------------------------
// Archived, dated recaps — see migrations/013_digests.sql and
// mutations.generateDigest for how a digest gets built. Reads only here;
// generation is a write (it inserts a row) so it lives in mutations.ts.

type DigestRow = {
  id: number
  period_start: string
  period_end: string
  summary: string
  highlights: { billId: string; identifier: string; title: string; detail: string }[]
  sections: { title: string; items: string[] }[]
  created_by: number | null
  created_by_name: string | null
  created_at: string
}

function shapeDigest(r: DigestRow) {
  return {
    id: String(r.id),
    periodStart: r.period_start,
    periodEnd: r.period_end,
    summary: r.summary,
    highlights: r.highlights,
    sections: r.sections,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  }
}

const DIGEST_SELECT = `
  SELECT d.id, d.period_start, d.period_end, d.summary, d.highlights, d.sections, d.created_by,
         u.name AS created_by_name, d.created_at
  FROM digests d
  LEFT JOIN users u ON u.id = d.created_by
`

export async function getDigests(workspaceId: number) {
  const { rows } = await pool.query<DigestRow>(`${DIGEST_SELECT} WHERE d.workspace_id = $1 ORDER BY d.created_at DESC`, [
    workspaceId,
  ])
  return rows.map(shapeDigest)
}

export async function getDigest(id: number, workspaceId: number) {
  const { rows } = await pool.query<DigestRow>(`${DIGEST_SELECT} WHERE d.id = $1 AND d.workspace_id = $2`, [
    id,
    workspaceId,
  ])
  return rows[0] ? shapeDigest(rows[0]) : null
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
