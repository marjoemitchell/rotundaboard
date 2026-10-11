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
          audio_playlist_url, transcript_status, transcript_source, waveform)
       VALUES ($1, $2, $3, $4, (now() AT TIME ZONE 'America/Denver')::timestamp(0), $5,
               'http://127.0.0.1:9/e2e/hls/master.m3u8', 'http://127.0.0.1:9/e2e/hls/audio.m3u8', $6, $7, $8)
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
