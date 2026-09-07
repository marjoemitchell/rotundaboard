import { pool } from './db.js'
import * as api from './legmtClient.js'
import { runWithConcurrency } from './concurrency.js'
import type { RawCommitteeMeeting } from './legmtTypes.js'

const TARGET_SESSION_ORDINALS = process.env.SCRAPE_SESSION_ORDINALS ?? '20251'
const CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 6)

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw lastErr
}

async function upsertCommitteeMeeting(m: RawCommitteeMeeting) {
  await pool.query(
    `INSERT INTO committee_meetings (id, standing_committee_id, meeting_time, location, comments, public_participation, bill_testimony, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       standing_committee_id = $2, meeting_time = $3, location = $4, comments = $5,
       public_participation = $6, bill_testimony = $7, status = $8`,
    [
      m.id,
      m.standingCommittee?.id ?? null,
      m.meetingTime,
      m.location,
      m.comments,
      m.publicParticipation,
      m.billTestimony,
      m.status,
    ],
  )
}

async function scrapeOneBill(billId: number) {
  const [votes, amendments, cosponsors, hearings, executiveActions] = await Promise.all([
    withRetries(() => api.getVotesForBill(billId)),
    withRetries(() => api.getAmendmentsForBill(billId)),
    withRetries(() => api.getCosponsorsForBill(billId)),
    withRetries(() => api.getHearingsForBill(billId)),
    withRetries(() => api.getExecutiveActionsForBill(billId)),
  ])

  for (const v of votes) {
    await pool.query(
      `INSERT INTO bill_votes (id, bill_id, motion, order_of_business_id, occurred_at, amendment_number, vote_motion, chamber, sequence, bill_status_id, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         bill_id = $2, motion = $3, order_of_business_id = $4, occurred_at = $5, amendment_number = $6,
         vote_motion = $7, chamber = $8, sequence = $9, bill_status_id = $10, result = $11`,
      [
        v.id,
        billId,
        v.motion,
        v.orderOfBusinessId,
        v.dateTime,
        v.amendmentNumber,
        v.voteMotion,
        v.systemId?.chamber ?? null,
        v.systemId?.sequence ?? null,
        v.billStatus?.id ?? null,
        v.billStatus?.result ?? null,
      ],
    )
    for (const lv of v.legislatorVotes ?? []) {
      await pool.query(
        `INSERT INTO bill_vote_legislator_votes (id, bill_vote_id, legislator_id, vote_type, voting_member_status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET bill_vote_id = $2, legislator_id = $3, vote_type = $4, voting_member_status = $5`,
        [lv.id, v.id, lv.legislatorId, lv.voteType, lv.votingMemberStatus],
      )
    }
  }

  for (const a of amendments) {
    await pool.query(
      `INSERT INTO amendments (id, bill_id, drafter_staff_member_id, bill_version, number, requestor_id, section, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         bill_id = $2, drafter_staff_member_id = $3, bill_version = $4, number = $5,
         requestor_id = $6, section = $7, type = $8`,
      [a.id, billId, a.drafterStaffMemberId, a.billVersion, a.number, a.requestorId, a.section, a.type],
    )
  }

  for (const c of cosponsors) {
    await pool.query(
      `INSERT INTO bill_cosponsors (id, bill_id, legislator_id) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET bill_id = $2, legislator_id = $3`,
      [c.id, billId, c.cosponsorId],
    )
  }

  for (const h of hearings) {
    await upsertCommitteeMeeting(h.committeeMeeting)
    await pool.query(
      `INSERT INTO committee_bill_hearings (id, bill_id, committee_meeting_id) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET bill_id = $2, committee_meeting_id = $3`,
      [h.id, billId, h.committeeMeeting.id],
    )
  }

  for (const ea of executiveActions) {
    if (ea.standingCommitteeMeeting) await upsertCommitteeMeeting(ea.standingCommitteeMeeting)
    await pool.query(
      `INSERT INTO executive_actions (id, bill_id, committee_meeting_id, vote_time, motion, bill_status_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         bill_id = $2, committee_meeting_id = $3, vote_time = $4, motion = $5, bill_status_id = $6`,
      [ea.id, billId, ea.standingCommitteeMeeting?.id ?? null, ea.voteTime, ea.motion, ea.billStatusId],
    )
    for (const lv of ea.legislatorVotes ?? []) {
      await pool.query(
        `INSERT INTO executive_action_legislator_votes (id, executive_action_id, legislator_id, membership_role_code, committee_vote)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           executive_action_id = $2, legislator_id = $3, membership_role_code = $4, committee_vote = $5`,
        [lv.id, ea.id, lv.membership?.legislatorId ?? null, lv.membership?.type?.code ?? null, lv.committeeVote],
      )
    }
  }
}

async function main() {
  const { rows: sessionRows } = await pool.query<{ id: number }>(
    'SELECT id FROM sessions WHERE ordinals = $1',
    [TARGET_SESSION_ORDINALS],
  )
  const session = sessionRows[0]
  if (!session) {
    throw new Error(`session ${TARGET_SESSION_ORDINALS} not found in DB — run "npm run scrape" first`)
  }

  const limit = process.env.SCRAPE_LIMIT ? Number(process.env.SCRAPE_LIMIT) : null
  const { rows: bills } = await pool.query<{ id: number }>(
    `SELECT id FROM bills WHERE session_id = $1 AND bill_number IS NOT NULL ORDER BY id${limit ? ' LIMIT ' + limit : ''}`,
    [session.id],
  )
  console.log(`fetching vote/hearing/amendment/cosponsor detail for ${bills.length} introduced bills (concurrency=${CONCURRENCY})...`)

  let done = 0
  let failed = 0
  await runWithConcurrency(bills, CONCURRENCY, async (bill) => {
    try {
      await scrapeOneBill(bill.id)
    } catch (err) {
      failed += 1
      console.error(`  bill ${bill.id} failed:`, err instanceof Error ? err.message : err)
    }
    done += 1
    if (done % 100 === 0) console.log(`  ...${done}/${bills.length} bills done (${failed} failed)`)
  })

  console.log(`done. ${done} bills processed, ${failed} failed.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
