import sanitizeHtml from 'sanitize-html'
import { pool } from './db.js'
import * as api from './legmtClient.js'
import { runWithConcurrency } from './concurrency.js'
import type {
  RawBillStatusCode,
  RawBillType,
  RawDraft,
  RawProgressCategory,
  RawStandingCommittee,
  RawSubjectCode,
} from './legmtTypes.js'

const TARGET_SESSION_ORDINALS = process.env.SCRAPE_SESSION_ORDINALS ?? '20251'

function toDateOnly(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null
}

// Lookup tables repeat the same few dozen codes across thousands of bills;
// track what's already been upserted this run so we don't re-issue the same
// statement thousands of times.
const seenProgressCategories = new Set<number>()
const seenBillStatusCodes = new Set<number>()
const seenSubjectCodes = new Set<number>()
const seenBillTypes = new Set<number>()

async function upsertProgressCategory(pc: RawProgressCategory | null) {
  if (!pc || seenProgressCategories.has(pc.id)) return
  seenProgressCategories.add(pc.id)
  await pool.query(
    `INSERT INTO progress_categories (id, code, description, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET code = $2, description = $3, sort_order = $4`,
    [pc.id, pc.code, pc.description, pc.sortOrder],
  )
}

async function upsertBillStatusCode(code: RawBillStatusCode | null) {
  if (!code || seenBillStatusCodes.has(code.id)) return
  seenBillStatusCodes.add(code.id)
  await upsertProgressCategory(code.billProgressCategory)
  await pool.query(
    `INSERT INTO bill_status_codes (id, code, name, chamber, action_weight, progress_category_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET code = $2, name = $3, chamber = $4, action_weight = $5, progress_category_id = $6`,
    [code.id, code.code, code.name, code.chamber, code.actionWeight, code.billProgressCategory?.id ?? null],
  )
}

async function upsertSubjectCode(subject: RawSubjectCode) {
  if (seenSubjectCodes.has(subject.id)) return
  seenSubjectCodes.add(subject.id)
  await pool.query(
    `INSERT INTO subject_codes (id, code, description, is_primary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET code = $2, description = $3, is_primary = $4`,
    [subject.id, subject.code, subject.description, subject.primary ?? null],
  )
}

async function upsertBillType(billType: RawBillType | null) {
  if (!billType || seenBillTypes.has(billType.id)) return
  seenBillTypes.add(billType.id)
  await pool.query(
    `INSERT INTO bill_types (id, code, description, chamber, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET code = $2, description = $3, chamber = $4, sort_order = $5`,
    [billType.id, billType.code, billType.description, billType.chamber, billType.sortOrder],
  )
}

async function upsertDraftAndBill(sessionId: number, draft: RawDraft, billId: number, billFields: {
  billNumber: number | null
  billTypeId: number | null
  sponsorId: number | null
  carrierId: number | null
  drafterStaffMemberId: number | null
  deadlineCodeId: number | null
  enrolled: boolean | null
  versionNumber: number | null
  sessionLawChapter: string | null
  sessionLawChapterNumber: number | null
}) {
  await pool.query(
    `INSERT INTO drafts (
       id, session_id, draft_number, drafted_at, short_title, description,
       requester_id, requester_type, has_legal_note, has_fiscal_note,
       fiscal_analyst_id, pre_intro_required
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       session_id = $2, draft_number = $3, drafted_at = $4, short_title = $5, description = $6,
       requester_id = $7, requester_type = $8, has_legal_note = $9, has_fiscal_note = $10,
       fiscal_analyst_id = $11, pre_intro_required = $12`,
    [
      draft.id,
      sessionId,
      draft.draftNumber,
      draft.date,
      draft.shortTitle,
      draft.description,
      draft.requesterId,
      draft.requesterType,
      draft.legalNote,
      draft.fiscalNote,
      draft.fiscalAnalystId,
      draft.preIntroRequired,
    ],
  )

  for (const ds of draft.subjects ?? []) {
    await upsertSubjectCode(ds.subjectCode)
    await pool.query(
      `INSERT INTO draft_subjects (draft_id, subject_code_id, is_primary)
       VALUES ($1, $2, $3)
       ON CONFLICT (draft_id, subject_code_id) DO UPDATE SET is_primary = $3`,
      [draft.id, ds.subjectCode.id, ds.subjectCode.primary ?? null],
    )
  }

  await pool.query(
    `INSERT INTO bills (
       id, session_id, draft_id, bill_type_id, bill_number, sponsor_id, carrier_id,
       drafter_staff_member_id, deadline_code_id, enrolled, version_number,
       session_law_chapter, session_law_chapter_number
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       session_id = $2, draft_id = $3, bill_type_id = $4, bill_number = $5, sponsor_id = $6,
       carrier_id = $7, drafter_staff_member_id = $8, deadline_code_id = $9, enrolled = $10,
       version_number = $11, session_law_chapter = $12, session_law_chapter_number = $13`,
    [
      billId,
      sessionId,
      draft.id,
      billFields.billTypeId,
      billFields.billNumber,
      billFields.sponsorId,
      billFields.carrierId,
      billFields.drafterStaffMemberId,
      billFields.deadlineCodeId,
      billFields.enrolled,
      billFields.versionNumber,
      billFields.sessionLawChapter,
      billFields.sessionLawChapterNumber,
    ],
  )

  for (const status of draft.billStatuses ?? []) {
    await upsertBillStatusCode(status.billStatusCode)
    await upsertProgressCategory(status.billProgressCategory)
    await pool.query(
      `INSERT INTO bill_statuses (
         id, draft_id, occurred_at, standing_committee_id, bill_status_code_id,
         progress_category_id, result, vote, scheduled_bill_hearing_id, executive_action_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         draft_id = $2, occurred_at = $3, standing_committee_id = $4, bill_status_code_id = $5,
         progress_category_id = $6, result = $7, vote = $8, scheduled_bill_hearing_id = $9,
         executive_action_id = $10`,
      [
        status.id,
        draft.id,
        status.timeStamp,
        status.standingCommitteeId,
        status.billStatusCode?.id ?? null,
        status.billProgressCategory?.id ?? null,
        status.result,
        status.vote ? JSON.stringify(status.vote) : null,
        status.scheduledBillHearingId,
        status.executiveActionId,
      ],
    )
  }
}

async function upsertLegislatorsAndDeps(legislature_id: number) {
  const legislators = await api.getLegislators()
  console.log(`fetched ${legislators.length} legislators`)

  const parties = new Map<number, { id: number; code: string; name: string }>()
  const districts = new Map<number, { id: number; chamber: string | null; number: number | null; name: string | null }>()
  const legislatures = new Map<number, { id: number; ordinal: number; startDate: string | null; endDate: string | null }>()

  for (const l of legislators) {
    if (l.politicalParty) parties.set(l.politicalParty.id, l.politicalParty)
    if (l.district) districts.set(l.district.id, l.district)
    if (l.legislature) {
      legislatures.set(l.legislature.id, {
        id: l.legislature.id,
        ordinal: Number(l.legislature.ordinals),
        startDate: l.legislature.startDate,
        endDate: l.legislature.endDate,
      })
    }
  }

  for (const leg of legislatures.values()) {
    await pool.query(
      `INSERT INTO legislatures (id, ordinal, start_date, end_date) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET ordinal = $2, start_date = $3, end_date = $4`,
      [leg.id, leg.ordinal, leg.startDate, leg.endDate],
    )
  }
  for (const p of parties.values()) {
    await pool.query(
      `INSERT INTO political_parties (id, code, name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET code = $2, name = $3`,
      [p.id, p.code, p.name],
    )
  }
  for (const d of districts.values()) {
    await pool.query(
      `INSERT INTO districts (id, chamber, number, name) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET chamber = $2, number = $3, name = $4`,
      [d.id, d.chamber, d.number, d.name],
    )
  }
  for (const l of legislators) {
    await pool.query(
      `INSERT INTO legislators (
         id, first_name, last_name, middle_name, display_name, chamber,
         legislature_id, political_party_id, district_id, start_date, end_date, email_address
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         first_name = $2, last_name = $3, middle_name = $4, display_name = $5, chamber = $6,
         legislature_id = $7, political_party_id = $8, district_id = $9, start_date = $10,
         end_date = $11, email_address = $12`,
      [
        l.id,
        l.firstName,
        l.lastName,
        l.middleName,
        l.displayName,
        l.chamber,
        l.legislature?.id ?? null,
        l.politicalParty?.id ?? null,
        l.district?.id ?? null,
        toDateOnly(l.startDate),
        toDateOnly(l.endDate),
        l.emailAddress,
      ],
    )
  }

  return legislature_id
}

async function upsertCommittees(sessionId: number) {
  const all = await api.getStandingCommittees()
  const forSession = all.filter((c) => c.sessionId === sessionId)
  console.log(`fetched ${all.length} standing committees total, ${forSession.length} for session ${sessionId}`)

  for (const c of forSession as RawStandingCommittee[]) {
    const details = c.committeeDetails
    await pool.query(
      `INSERT INTO standing_committees (
         id, session_id, chamber, code, name, committee_type, default_room, default_day, default_time
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         session_id = $2, chamber = $3, code = $4, name = $5, committee_type = $6,
         default_room = $7, default_day = $8, default_time = $9`,
      [
        c.id,
        c.sessionId,
        c.chamber,
        details.committeeCode.code,
        details.committeeCode.name,
        details.committeeCode.committeeType?.description ?? null,
        details.defaultRoom,
        details.defaultDays,
        details.defaultTime,
      ],
    )
    for (const m of c.memberships ?? []) {
      await pool.query(
        `INSERT INTO committee_memberships (id, committee_id, legislator_id, role_code, role_name, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           committee_id = $2, legislator_id = $3, role_code = $4, role_name = $5, start_date = $6, end_date = $7`,
        [m.id, c.id, m.legislatorId, m.type.code, m.type.name, toDateOnly(m.startDate), toDateOnly(m.endDate)],
      )
    }
  }
}

async function upsertNonStandingCommittees(legislatureId: number) {
  const committees = await api.getNonStandingCommittees(legislatureId)
  console.log(`fetched ${committees.length} non-standing (interim) committees`)

  for (const c of committees) {
    const code = c.committeeDetails.committeeCode
    await pool.query(
      `INSERT INTO non_standing_committees (id, legislature_id, code, name, committee_type)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET legislature_id = $2, code = $3, name = $4, committee_type = $5`,
      [c.id, c.legislatureId, code.code, code.name, code.committeeType?.description ?? null],
    )
    for (const m of c.memberships ?? []) {
      await pool.query(
        `INSERT INTO non_standing_committee_memberships (id, committee_id, legislator_id, role_code, role_name, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           committee_id = $2, legislator_id = $3, role_code = $4, role_name = $5, start_date = $6, end_date = $7`,
        [m.id, c.id, m.legislatorId, m.type.code, m.type.name, toDateOnly(m.startDate), toDateOnly(m.endDate)],
      )
    }
  }
}

export async function upsertNonStandingCommitteeMeetings(committeeIds: number[]) {
  let count = 0
  for await (const meeting of api.iterateNonStandingCommitteeMeetings(committeeIds)) {
    await pool.query(
      `INSERT INTO non_standing_committee_meetings (
         id, non_standing_committee_id, meeting_time, meeting_end_time, location,
         comments, public_participation, status, agenda_items
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         non_standing_committee_id = $2, meeting_time = $3, meeting_end_time = $4, location = $5,
         comments = $6, public_participation = $7, status = $8, agenda_items = $9`,
      [
        meeting.id,
        meeting.nonStandingCommittee?.id ?? null,
        meeting.meetingTime,
        meeting.meetingEndTime,
        meeting.location,
        meeting.comments,
        meeting.publicParticipation,
        meeting.status,
        JSON.stringify(meeting.agendaItems ?? []),
      ],
    )
    count += 1
  }
  console.log(`fetched ${count} interim committee meetings`)
}

// This content comes from legmt.gov's own public WordPress site (a
// different host and system entirely from bearbeta.legmt.gov), so it's
// sanitized on the way in — we don't control that system, and it gets
// rendered as real HTML in the app (see CommitteeDetailPage.tsx).
const MATERIALS_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 6)

export async function upsertCommitteeMaterials(committeeIds: number[]) {
  let committeesWithContent = 0
  let tabsWritten = 0
  await runWithConcurrency(committeeIds, MATERIALS_CONCURRENCY, async (committeeId) => {
    let response
    try {
      response = await api.getCommitteeTabs(committeeId)
    } catch (err) {
      // Not every committee necessarily has a WordPress page (e.g. one
      // created mid-interim with no content yet) — skip rather than fail
      // the whole run over one missing committee.
      console.warn(`  committee ${committeeId}: ${err instanceof Error ? err.message : err}`)
      return
    }
    let wroteAny = false
    for (const tab of response.tabs ?? []) {
      const html = (tab.sections ?? [])
        .flatMap((s) => s.layouts ?? [])
        .map((l) => l.content ?? '')
        .join('\n')
        .trim()
      if (!html) continue
      const clean = sanitizeHtml(html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
        allowedAttributes: { a: ['href', 'target', 'rel'], '*': ['class'] },
        allowedSchemes: ['http', 'https', 'mailto'],
      })
      await pool.query(
        `INSERT INTO non_standing_committee_materials (committee_id, tab_title, content_html, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (committee_id, tab_title) DO UPDATE SET content_html = $3, updated_at = now()`,
        [committeeId, tab.tabTitle, clean],
      )
      tabsWritten += 1
      wroteAny = true
    }
    if (wroteAny) committeesWithContent += 1
  })
  console.log(`fetched committee materials: ${tabsWritten} tabs across ${committeesWithContent} committees`)
}

async function main() {
  console.log(`looking up session ${TARGET_SESSION_ORDINALS}...`)
  const sessions = await api.getSessions()
  const target = sessions.find((s) => s.ordinals === TARGET_SESSION_ORDINALS)
  if (!target) {
    throw new Error(
      `session ${TARGET_SESSION_ORDINALS} not found among: ${sessions.map((s) => s.ordinals).join(', ')}`,
    )
  }
  console.log(`target session id=${target.id} (${target.type}, legislature ${target.legislature.ordinals})`)

  // Upsert every session the API knows about, not just the target — the
  // session-clock strip needs the *next* session's convene date (2027 as of
  // this writing) even though we only pull bill data for the target session.
  for (const s of sessions) {
    await pool.query(
      `INSERT INTO legislatures (id, ordinal, start_date, end_date) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET ordinal = $2, start_date = $3, end_date = $4`,
      [s.legislature.id, Number(s.legislature.ordinals), s.legislature.startDate, s.legislature.endDate],
    )
    await pool.query(
      `INSERT INTO sessions (id, legislature_id, ordinals, session_type, start_date, sine_die_date, first_count_date, second_count_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         legislature_id = $2, ordinals = $3, session_type = $4, start_date = $5,
         sine_die_date = $6, first_count_date = $7, second_count_date = $8`,
      [
        s.id,
        s.legislature.id,
        s.ordinals,
        s.type,
        toDateOnly(s.startDate),
        s.sineDieDate,
        s.firstCountDate,
        s.secondCountDate,
      ],
    )
  }

  await upsertLegislatorsAndDeps(target.legislature.id)
  await upsertCommittees(target.id)
  await upsertNonStandingCommittees(target.legislature.id)

  const { rows: nonStandingCommittees } = await pool.query<{ id: number }>(
    'SELECT id FROM non_standing_committees WHERE legislature_id = $1',
    [target.legislature.id],
  )
  await upsertNonStandingCommitteeMeetings(nonStandingCommittees.map((c) => c.id))
  await upsertCommitteeMaterials(nonStandingCommittees.map((c) => c.id))

  console.log('fetching bills...')
  let count = 0
  for await (const bill of api.iterateBillsForSession(target.id)) {
    await upsertBillType(bill.billType)
    await upsertDraftAndBill(target.id, bill.draft, bill.id, {
      billNumber: bill.billNumber,
      billTypeId: bill.billType?.id ?? null,
      sponsorId: bill.sponsorId,
      carrierId: bill.carrierId,
      drafterStaffMemberId: bill.drafterStaffMemberId,
      deadlineCodeId: bill.deadlineCodeId,
      enrolled: bill.enrolled,
      versionNumber: bill.versionNumber,
      sessionLawChapter: bill.sessionLawChapter,
      sessionLawChapterNumber: bill.sessionLawChapterNumber,
    })
    count += 1
    if (count % 250 === 0) console.log(`  ...${count} bills/drafts processed`)
  }
  console.log(`done. ${count} bills/drafts processed for session ${TARGET_SESSION_ORDINALS}.`)
}

// Guarded so other scripts can import upsertNonStandingCommitteeMeetings
// (e.g. refreshCommitteeMeetings.ts) without triggering a full bill scrape
// as an import side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
