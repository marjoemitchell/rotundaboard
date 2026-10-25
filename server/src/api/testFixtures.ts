// Dev/test-only fixtures for the e2e suite (mounted in server.ts only when
// NODE_ENV !== 'production'). Hearing recordings come from an external
// archive plus paid transcription, so the suite can't create real ones on
// demand — this inserts a recording with a known transcript instead. Rows
// are tagged nomad_item_id 'e2e-...' so e2eCleanup.ts can sweep them.
import { pool } from '../db.js'

export interface HearingFixtureInput {
  suffix: string
  status?: 'processing' | 'ready'
  durationSeconds?: number
  speakers?: { label: string; displayName: string }[]
  segments: { start: number; end: number; speakerLabel?: string | null; text: string }[]
  /** An AI summary, as summarizeHearings.ts stores it. */
  aiSummary?: unknown
}

export async function createHearingFixture(input: HearingFixtureInput): Promise<{ id: string; committee: string }> {
  const { rows: committees } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM non_standing_committees WHERE name IS NOT NULL ORDER BY id LIMIT 1',
  )
  const committee = committees[0]
  if (!committee) throw new Error('no committees in the database to attach a hearing fixture to')
  const status = input.status ?? 'ready'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Recorded "now" (Mountain wall clock, like the real pipeline) so it's
    // the most recent recording and leads the dashboard's player. The
    // stream URLs deliberately point at a closed local port: tests exercise
    // seeking and transcript UI, not the archive's CDN, and a refused
    // connection fails instantly — an unresolvable hostname instead makes
    // every proxied request wait on DNS in libuv's small threadpool, which
    // bcrypt shares, stalling signups/logins across the parallel suite.
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO hearing_recordings
         (nomad_item_id, committee_id, title, committee_name, recorded_at, duration_seconds, hls_url,
          audio_playlist_url, transcript_status, transcript_source, waveform,
          ai_summary, ai_summary_model, ai_summarized_at)
       VALUES ($1, $2, $3, $4, (now() AT TIME ZONE 'America/Denver')::timestamp(0), $5,
               'http://127.0.0.1:9/e2e/hls/master.m3u8', 'http://127.0.0.1:9/e2e/hls/audio.m3u8', $6, $7, $8,
               $9::jsonb, CASE WHEN $9::jsonb IS NOT NULL THEN 'e2e-fixture' END,
               CASE WHEN $9::jsonb IS NOT NULL THEN now() END)
       RETURNING id`,
      [
        `e2e-${input.suffix}`,
        committee.id,
        `E2E fixture, ${committee.name}`,
        committee.name,
        input.durationSeconds ?? 600,
        status,
        status === 'ready' ? 'diarized' : 'captions',
        JSON.stringify(status === 'ready' ? Array.from({ length: 40 }, (_, i) => Math.round(Math.abs(Math.sin(i / 3)) * 100) / 100) : []),
        input.aiSummary ? JSON.stringify(input.aiSummary) : null,
      ],
    )
    const id = rows[0].id
    for (const [seq, s] of input.segments.entries()) {
      await client.query(
        `INSERT INTO hearing_transcript_segments (recording_id, seq, start_seconds, end_seconds, speaker_label, text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, seq, s.start, s.end, s.speakerLabel ?? null, s.text],
      )
    }
    for (const sp of input.speakers ?? []) {
      await client.query(
        'INSERT INTO hearing_speakers (recording_id, label, display_name) VALUES ($1, $2, $3)',
        [id, sp.label, sp.displayName],
      )
    }
    await client.query('COMMIT')
    return { id: String(id), committee: committee.name }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// A fake status change on a bill, as if a scrape had just picked one up.
// Negative ids can't collide with the Legislature's own (all positive) and
// mark the row as a fixture for e2eCleanup.ts.
export async function createStatusChangeFixture(billId: number, daysAgo = 0): Promise<{ statusId: number }> {
  const statusId = -(Math.floor(Math.random() * 1_000_000_000) + 1)
  const { rowCount } = await pool.query(
    `INSERT INTO bill_statuses (id, draft_id, occurred_at, bill_status_code_id)
     SELECT $1, b.draft_id, ((now() AT TIME ZONE 'America/Denver') - make_interval(days => $3))::timestamp(0),
            (SELECT id FROM bill_status_codes ORDER BY id LIMIT 1)
     FROM bills b WHERE b.id = $2`,
    [statusId, billId, daysAgo],
  )
  if (!rowCount) throw new Error(`bill ${billId} not found`)
  return { statusId }
}

// A scrape run with a given age and status, for the data freshness display.
// The counts mark the row as a fixture for e2eCleanup.ts.
export async function createScrapeRunFixture(job: string, status: string, hoursAgo: number): Promise<void> {
  await pool.query(
    `INSERT INTO scrape_runs (job, started_at, finished_at, status, counts)
     VALUES ($1, now() - make_interval(secs => $3::float8 * 3600 + 60), now() - make_interval(secs => $3::float8 * 3600), $2,
             '{"e2eFixture": 1}')`,
    [job, status, hoursAgo],
  )
}

// A bill hearing on a standing committee meeting, as refreshHearings.ts
// would store it. Negative ids mark fixtures for e2eCleanup.ts. Call it again
// with the same ids to move, cancel, or remove the hearing.
export async function upsertBillHearingFixture(input: {
  billId: number
  hearingId: number
  meetingId: number
  hoursFromNow: number
  location: string
  meetingStatus?: string | null
  hearingStatus?: string | null
  removed?: boolean
}): Promise<{ committee: string }> {
  if (input.hearingId >= 0 || input.meetingId >= 0) throw new Error('fixture ids must be negative')
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM standing_committees WHERE name IS NOT NULL ORDER BY id LIMIT 1',
  )
  if (!rows[0]) throw new Error('no standing committees to attach a hearing fixture to')
  await pool.query(
    `INSERT INTO committee_meetings (id, standing_committee_id, meeting_time, location, status)
     VALUES ($1, $2, date_trunc('minute', (now() AT TIME ZONE 'America/Denver') + make_interval(secs => $3::float8 * 3600)), $4, $5)
     ON CONFLICT (id) DO UPDATE SET meeting_time = EXCLUDED.meeting_time, location = $4, status = $5`,
    [input.meetingId, rows[0].id, input.hoursFromNow, input.location, input.meetingStatus ?? 'SCHEDULED'],
  )
  await pool.query(
    `INSERT INTO committee_bill_hearings (id, bill_id, committee_meeting_id, status, removed_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)
     ON CONFLICT (id) DO UPDATE SET status = $4, removed_at = CASE WHEN $5 THEN now() END`,
    [input.hearingId, input.billId, input.meetingId, input.hearingStatus ?? null, Boolean(input.removed)],
  )
  return { committee: rows[0].name }
}

// Makes the "hearing scheduled" alert for a fixture hearing look older, so
// that the reminder (which waits some hours after an announcement) can run.
export async function ageHearingAlertFixture(hearingId: number, hours: number): Promise<void> {
  await pool.query(
    `UPDATE change_events SET detected_at = now() - make_interval(secs => $2::float8 * 3600)
     WHERE key LIKE 'hearing:' || $1 || ':%'`,
    [hearingId, hours],
  )
}

// Bill text fixtures: two versions of a bill, and one amendment with a
// summary. The text is small and known, so a test can check the redline.
// Negative ids mark fixtures for e2eCleanup.ts. The fixture replaces the
// stored text of the bill.
export async function billTextFixture(input: {
  billId: number
  amendmentId: number
  documentId: number
  summary?: string | null
  /** Hours since the amendment first appeared. */
  amendmentAgeHours?: number
}): Promise<{ amendmentNumber: number }> {
  const { changedParagraphs, diffParagraphs } = await import('../billText.js')
  type Paragraph = import('../billText.js').Paragraph
  const v1: Paragraph[] = [
    [['Section 1. Fees.', 0]],
    [['The license fee is', 0], [' ', 0], ['$25', 1], [' ', 0], ['$40', 2], [' for each year.', 0]],
    [['Section 2. Effective date. This act is effective July 1, 2027.', 0]],
  ]
  const v2: Paragraph[] = [
    [['Section 1. Fees.', 0]],
    [
      ['The license fee is', 0], [' ', 0], ['$25', 1], [' ', 0], ['$35', 2], [' for each', 0], [' ', 0], ['year.', 1],
      [' ', 0], ['license year.', 2],
    ],
    [['A veteran does not pay the fee.', 2]],
    [['Section 2. Effective date. This act is effective July 1, 2027.', 0]],
  ]
  await pool.query(`DELETE FROM amendment_documents WHERE bill_id = $1`, [input.billId])
  await pool.query(`DELETE FROM bill_text_versions WHERE bill_id = $1`, [input.billId])
  await pool.query(
    `INSERT INTO bill_text_versions (id, bill_id, version_key, file_name, posted_at, paragraphs) VALUES
       ($1 - 1, $2, '1', 'E2E_1.pdf', now() - interval '20 days', $3),
       ($1 - 2, $2, '2', 'E2E_2.pdf', now() - interval '10 days', $4)`,
    [input.documentId, input.billId, JSON.stringify(v1), JSON.stringify(v2)],
  )
  const amendmentNumber = Math.abs(input.amendmentId) % 1_000_000
  await pool.query(
    `INSERT INTO amendments (id, bill_id, bill_version, number, type, section, first_seen_at)
     VALUES ($1, $2, 1, $3, 'COMMITTEE', 'committee', now() - make_interval(secs => $4::float8 * 3600))
     ON CONFLICT (id) DO UPDATE SET first_seen_at = EXCLUDED.first_seen_at`,
    [input.amendmentId, input.billId, amendmentNumber, input.amendmentAgeHours ?? 0],
  )
  const changes = changedParagraphs(diffParagraphs(v1, v2))
  await pool.query(
    `INSERT INTO amendment_documents
       (id, bill_id, amendment_id, base_name, bill_version, number, file_name, posted_at, changes, summary, summarized_at)
     VALUES ($1, $2, $3, $7, 1, $4, 'E2E_amendment.pdf', now() - interval '12 days', $5, $6::text,
             CASE WHEN $6::text IS NOT NULL THEN now() END)`,
    [
      input.documentId,
      input.billId,
      input.amendmentId,
      amendmentNumber,
      JSON.stringify(changes),
      input.summary ?? null,
      `E2E.001.${amendmentNumber}`,
    ],
  )
  return { amendmentNumber }
}

// Open LC drafts in a session that has not ended, for the dashboard tests.
// The scraped data has few open bills between sessions. Negative ids mark
// the fixtures for e2eCleanup.ts. The first subject code of the database goes
// on each draft, so a subject watch on that code matches them.
export async function openDraftsFixture(input: {
  count: number
  titlePrefix?: string
  /** How old the newest draft is, in minutes. Older drafts are not in the newest suggestions. */
  ageMinutes?: number
}): Promise<{
  bills: { billId: string; identifier: string; title: string }[]
  subjectCode: string
}> {
  const { rows: sessions } = await pool.query<{ id: number }>(
    `SELECT id FROM sessions WHERE sine_die_date IS NULL OR sine_die_date > now() ORDER BY start_date DESC LIMIT 1`,
  )
  if (!sessions[0]) throw new Error('no open session to attach draft fixtures to')
  const { rows: subjects } = await pool.query<{ id: number; code: string }>('SELECT id, code FROM subject_codes ORDER BY id LIMIT 1')
  const base = Math.floor(Math.random() * 100_000_000) + 1
  const bills: { billId: string; identifier: string; title: string }[] = []
  for (let i = 0; i < input.count; i++) {
    const id = -(base * 10 + i)
    const number = String(9000 + ((base + i) % 1000)).padStart(4, '0')
    const title = `${input.titlePrefix ?? 'E2E draft'} ${base}-${i}`
    await pool.query(
      `INSERT INTO drafts (id, session_id, draft_number, drafted_at, short_title, requester_type)
       VALUES ($1, $2, $3, now() - make_interval(mins => $4), $5, 'AGENCY')`,
      [id, sessions[0].id, `LC${number}`, (input.ageMinutes ?? 0) + i, title],
    )
    await pool.query('INSERT INTO bills (id, session_id, draft_id, bill_number) VALUES ($1, $2, $1, NULL)', [id, sessions[0].id])
    if (subjects[0]) {
      await pool.query('INSERT INTO draft_subjects (draft_id, subject_code_id, is_primary) VALUES ($1, $2, true)', [id, subjects[0].id])
    }
    bills.push({ billId: String(id), identifier: `LC ${number}`, title })
  }
  return { bills, subjectCode: subjects[0]?.code ?? '' }
}

// An interim committee meeting a few days from now, with agenda items. The
// test follows the committee to see the meeting on the dashboard. Negative
// ids mark the fixture for e2eCleanup.ts.
export async function committeeMeetingFixture(input: {
  daysFromNow: number
  location?: string
  agenda?: string[]
}): Promise<{ committeeId: string; committee: string; meetingId: number }> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM non_standing_committees WHERE name IS NOT NULL ORDER BY id LIMIT 1',
  )
  if (!rows[0]) throw new Error('no committees to attach a meeting fixture to')
  const meetingId = -(Math.floor(Math.random() * 1_000_000_000) + 1)
  const agenda = (input.agenda ?? []).map((title, i) => ({ id: -(i + 1), title, description: '', orderNumber: i + 1 }))
  await pool.query(
    `INSERT INTO non_standing_committee_meetings (id, non_standing_committee_id, meeting_time, location, status, agenda_items)
     VALUES ($1, $2, date_trunc('minute', (now() AT TIME ZONE 'America/Denver') + make_interval(days => $3)), $4, 'SCHEDULED', $5)`,
    [meetingId, rows[0].id, input.daysFromNow, input.location ?? 'Room 102 (E2E)', JSON.stringify(agenda)],
  )
  return { committeeId: String(rows[0].id), committee: rows[0].name, meetingId }
}

// A bill summary with a given source, for a fixture bill (negative id: the
// cleanup removes the bill, and the summary with it).
export async function billSummaryFixture(input: {
  billId: number
  summary: string
  source: 'text' | 'metadata'
  versionKey?: string
}): Promise<void> {
  if (input.billId >= 0) throw new Error('use a fixture bill (negative id)')
  await pool.query(
    `INSERT INTO bill_summaries (bill_id, summary, model, source, version_key, version_posted_at)
     VALUES ($1, $2, 'e2e-fixture', $3, $4, CASE WHEN $4::text IS NOT NULL THEN timestamptz '2025-03-19 12:00:00-06' END)
     ON CONFLICT (bill_id) DO UPDATE SET summary = $2, source = $3, version_key = $4,
       version_posted_at = CASE WHEN $4::text IS NOT NULL THEN timestamptz '2025-03-19 12:00:00-06' END`,
    [input.billId, input.summary, input.source, input.versionKey ?? null],
  )
}

// A system account in a real Senate seat, like "Service ZZ-User" in the
// Legislature's data. The term started after the term of the real member,
// so without the filter the map shows the account. A negative id marks the
// fixture for e2eCleanup.ts.
export async function placeholderLegislatorFixture(input: { senateDistrict: number }): Promise<{ id: string }> {
  const { rows: districts } = await pool.query<{ id: number }>(
    `SELECT id FROM districts WHERE chamber ILIKE 'senate' AND number = $1`,
    [input.senateDistrict],
  )
  if (!districts[0]) throw new Error(`no Senate district ${input.senateDistrict}`)
  const { rows: serving } = await pool.query<{ legislature_id: number }>(
    'SELECT legislature_id FROM sessions WHERE start_date <= now() ORDER BY start_date DESC LIMIT 1',
  )
  const id = -(Math.floor(Math.random() * 1_000_000_000) + 1)
  await pool.query(
    `INSERT INTO legislators (id, first_name, last_name, chamber, legislature_id, district_id, start_date, end_date, email_address)
     VALUES ($1, 'Service', 'ZZ-User', 'SENATE', $2, $3, now() - interval '1 day', now() + interval '1 year', 'service.zz-user@legmt.gov')`,
    [id, serving[0]?.legislature_id ?? null, districts[0].id],
  )
  return { id: String(id) }
}
