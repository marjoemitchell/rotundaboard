// Hearing transcription pipeline (cron). Each run:
//
//   1. Discover — searches the Legislature's Nomad Media video archive for
//      every interim committee we know about, and records any meeting video
//      that has been posted (an archive item with an HLS stream) in the last
//      FIND_RECORDINGS_DAYS (see recordingWindows.ts), or since --since.
//      Matched to our scraped non_standing_committee_meetings row by
//      committee + date where possible.
//   2. Captions — for newly posted recordings, ingests the archive's own
//      live-caption .vtt right away so the hearing is searchable/seekable
//      within one cron tick of the video going up (transcript_status
//      'processing', no speakers).
//   3. Diarize — downloads the audio, transcribes it with speaker
//      diarization (diarize.ts; TRANSCRIBE_BACKEND picks our own WhisperX
//      GPU service or OpenAI), names the speakers (identifySpeakers.ts),
//      and replaces the caption segments (transcript_status 'ready').
//      Bounded to --limit recordings per run; ANTHROPIC_API_KEY is needed
//      for speaker names (without it, speakers stay "Speaker N"). Only the
//      recordings of the last FULL_TRANSCRIPT_DAYS, or since --since, get
//      this step. Older recordings keep the captions.
//
// Deployment: the primary runner is a GPU box (TRANSCRIBE_BACKEND=whisperx,
// see deploy/unraid/), which records a heartbeat each healthy run. The
// Railway cron runs with --fallback-after-hours, so it only pays for OpenAI
// when that heartbeat has gone stale (box down) — never in parallel with a
// working GPU box.
//
// Usage:
//   npm run transcribe-hearings                         # normal run
//   npm run transcribe-hearings -- --since=2026-01-01   # find and fully transcribe since a date
//   npm run transcribe-hearings -- --limit=1            # diarize at most 1 hearing
//   npm run transcribe-hearings -- --recording=<nomad item id>   # (re)process one
//   npm run transcribe-hearings -- --captions-only      # skip diarization
//   npm run transcribe-hearings -- --names-only         # only the speaker names step,
//       for transcripts without names (add --recording=<id> to do one again)
//   npm run transcribe-hearings -- --fallback-after-hours=6
//       # diarize only if the WhisperX box hasn't checked in for 6h
import 'dotenv/config'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PoolClient } from 'pg'
import { pool } from './db.js'
import { FIND_RECORDINGS_DAYS, FULL_TRANSCRIPT_DAYS, windowStart } from './recordingWindows.js'
import { runWithConcurrency } from './concurrency.js'
import * as nomad from './nomadClient.js'
import { computeWaveform, probeDurationSeconds } from './hearingAudio.js'
import { backendUnavailableReason, diarizeAudio, transcribeBackend, type DiarizedSegment, type TranscribeBackend } from './diarize.js'
import { identifySpeakers, type RosterEntry } from './identifySpeakers.js'
import { attributeSpeakers, mergeSpeakerTurns, speakerCountHint, transcriptionPrompt, type SpeakerRow } from './speakerAttribution.js'

const DEFAULT_DIARIZE_LIMIT = 4
const MAX_ATTEMPTS = 3
const WHISPERX_HEARTBEAT = 'whisperx-transcriber'
// Arbitrary constant key so overlapping cron runs can't double-process.
const ADVISORY_LOCK_KEY = 7_340_018

interface RecordingRow {
  id: number
  nomad_item_id: string
  committee_id: number | null
  committee_name: string
  recorded_at: string
  duration_seconds: number
  audio_playlist_url: string | null
  caption_url: string | null
  transcript_status: string
  transcript_source: string | null
  attempts: number
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------- discover

async function discoverRecordings(since: string, fullTranscriptSince: string): Promise<number> {
  const { rows: committees } = await pool.query<{ id: number; code: string | null; name: string }>(
    'SELECT id, code, name FROM non_standing_committees WHERE name IS NOT NULL',
  )
  // Recordings we already have are re-checked until they're diarized and
  // the archive has finished processing them (captions posted): a freshly
  // posted video is the raw recording, which the archive later replaces with
  // a processed version that adds captions and an audio-only rendition.
  // Once diarized, a recording's URLs are pinned — the transcript's
  // timestamps belong to that exact stream, and the processed version isn't
  // guaranteed to be trimmed identically.
  // A recording older than the full transcript window is settled too. It
  // gets no full transcript, so the job does not check it again on each run.
  const { rows: knownRows } = await pool.query<{ nomad_item_id: string; settled: boolean }>(
    `SELECT nomad_item_id,
            (transcript_source = 'diarized' OR caption_url IS NOT NULL OR recorded_at < $1) AS settled
     FROM hearing_recordings`,
    [fullTranscriptSince],
  )
  const settled = new Set(knownRows.filter((r) => r.settled).map((r) => r.nomad_item_id))
  const known = new Set(knownRows.map((r) => r.nomad_item_id))
  let added = 0

  await runWithConcurrency(committees, 4, async (committee) => {
    let results: nomad.NomadSearchResult[]
    try {
      results = await nomad.search(committee.name)
    } catch (err) {
      console.warn(`  search failed for ${committee.name}: ${(err as Error).message}`)
      return
    }
    for (const result of results) {
      if (result.contentDefinition?.description !== 'Meeting' || settled.has(result.itemId)) continue
      const parsed = nomad.parseMeetingTitle(result.title)
      // Exact name match: searching "Legislative Council" also returns
      // "Legislative Council Rules Subcommittee" meetings.
      if (!parsed || normalizeName(parsed.committeeName) !== normalizeName(committee.name)) continue
      if (parsed.recordedAt < since) continue

      try {
        const item = await nomad.getItem(result.itemId)
        const hlsUrl = item.video?.fullHlsUrl
        // No archived asset yet: either nothing is posted, or (for upcoming
        // meetings) fullHlsUrl is the room's live stream, not a recording.
        // Check again next run.
        if (!hlsUrl || !item.video?.assetId) continue
        const caption =
          item.subtitles?.find((s) => s.language?.startsWith('en') && s.isDefault) ??
          item.subtitles?.find((s) => s.language?.startsWith('en'))
        const audioPlaylistUrl = await nomad.resolveAudioPlaylistUrl(hlsUrl)
        const duration =
          item.duration ?? (audioPlaylistUrl ? await nomad.playlistDurationSeconds(audioPlaylistUrl) : 0)
        if (committee.code && item.committee?.description && item.committee.description !== committee.code) {
          console.warn(`  ${result.title}: archive committee code ${item.committee.description} != ours (${committee.code})`)
        }

        const { rows: meetingRows } = await pool.query<{ id: number }>(
          `SELECT id FROM non_standing_committee_meetings
           WHERE non_standing_committee_id = $1 AND meeting_time::date = $2::timestamp::date
           ORDER BY abs(extract(epoch FROM meeting_time - $2::timestamp)) LIMIT 1`,
          [committee.id, parsed.recordedAt],
        )

        const { rowCount } = await pool.query(
          `INSERT INTO hearing_recordings
             (nomad_item_id, committee_id, meeting_id, title, committee_name, recorded_at, duration_seconds,
              hls_url, audio_playlist_url, caption_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (nomad_item_id) DO UPDATE SET
             title = EXCLUDED.title, duration_seconds = EXCLUDED.duration_seconds, hls_url = EXCLUDED.hls_url,
             audio_playlist_url = EXCLUDED.audio_playlist_url, caption_url = EXCLUDED.caption_url, updated_at = now()
           WHERE hearing_recordings.transcript_source IS DISTINCT FROM 'diarized'
             AND (hearing_recordings.hls_url, hearing_recordings.caption_url)
                 IS DISTINCT FROM (EXCLUDED.hls_url, EXCLUDED.caption_url)`,
          [
            item.itemId,
            committee.id,
            meetingRows[0]?.id ?? null,
            item.title,
            committee.name,
            parsed.recordedAt,
            Math.round(duration),
            hlsUrl,
            audioPlaylistUrl,
            caption?.fullUrl ?? null,
          ],
        )
        if (rowCount) {
          const isNew = !known.has(item.itemId)
          if (isNew) added += 1
          known.add(item.itemId)
          console.log(
            `  ${isNew ? '+' : '~'} ${item.title}${caption ? '' : ' (no captions yet)'}${meetingRows[0] ? '' : ' (no matching scheduled meeting)'}`,
          )
        }
      } catch (err) {
        console.warn(`  ${result.title}: ${(err as Error).message}`)
      }
    }
  })
  return added
}

// ---------------------------------------------------------------- captions

// Nomad's captions arrive as ~6-second fragments of the live caption line.
// Merge them into paragraph-sized segments so each transcript line (and
// each clip-to-notes) carries a usable amount of text.
const CAPTION_MAX_GAP_SECONDS = 2
const CAPTION_MAX_SEGMENT_SECONDS = 30

function mergeCaptionCues(cues: nomad.Cue[]): { start: number; end: number; text: string }[] {
  const merged: { start: number; end: number; text: string }[] = []
  for (const cue of cues) {
    const last = merged[merged.length - 1]
    if (last && cue.start - last.end <= CAPTION_MAX_GAP_SECONDS && cue.end - last.start <= CAPTION_MAX_SEGMENT_SECONDS) {
      last.end = Math.max(last.end, cue.end)
      last.text = `${last.text} ${cue.text}`
    } else {
      merged.push({ ...cue })
    }
  }
  return merged
}

async function replaceSegments(
  client: PoolClient,
  recordingId: number,
  segments: { start: number; end: number; speaker: string | null; text: string }[],
) {
  await client.query('DELETE FROM hearing_transcript_segments WHERE recording_id = $1', [recordingId])
  if (segments.length === 0) return
  await client.query(
    `INSERT INTO hearing_transcript_segments (recording_id, seq, start_seconds, end_seconds, speaker_label, text)
     SELECT $1, s.seq, s.start_seconds, s.end_seconds, s.speaker_label, s.text
     FROM unnest($2::int[], $3::real[], $4::real[], $5::text[], $6::text[])
       AS s(seq, start_seconds, end_seconds, speaker_label, text)`,
    [
      recordingId,
      segments.map((_, i) => i),
      segments.map((s) => s.start),
      segments.map((s) => s.end),
      segments.map((s) => s.speaker),
      segments.map((s) => s.text),
    ],
  )
}

async function ingestCaptions(rec: RecordingRow): Promise<void> {
  const cues = nomad.parseVtt(await nomad.getText(rec.caption_url!))
  const segments = mergeCaptionCues(cues).map((s) => ({ ...s, speaker: null }))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await replaceSegments(client, rec.id, segments)
    await client.query(
      `UPDATE hearing_recordings
       SET transcript_status = 'processing', transcript_source = 'captions', updated_at = now()
       WHERE id = $1`,
      [rec.id],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  console.log(`  captions: ${rec.committee_name} ${rec.recorded_at} — ${segments.length} segments`)
}

// ---------------------------------------------------------------- diarize

async function loadRoster(committeeId: number | null): Promise<RosterEntry[]> {
  const { rows } = await pool.query<{
    id: number
    first_name: string | null
    last_name: string | null
    chamber: string | null
    role_name: string | null
  }>(
    `SELECT DISTINCT ON (l.id) l.id, l.first_name, l.last_name, l.chamber, m.role_name
     FROM legislators l
     LEFT JOIN non_standing_committee_memberships m ON m.legislator_id = l.id AND m.committee_id = $1
     WHERE m.committee_id IS NOT NULL
        OR l.legislature_id = (SELECT max(legislature_id) FROM legislators)
     ORDER BY l.id, m.role_name NULLS LAST`,
    [committeeId],
  )
  return rows.map((r) => ({
    legislatorId: r.id,
    name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    chamber: r.chamber,
    committeeRole: r.role_name,
  }))
}

async function diarizeRecording(rec: RecordingRow, backend: TranscribeBackend): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'rotunda-hearing-'))
  try {
    const audioPath = path.join(workDir, 'audio.mp4')
    const t0 = Date.now()
    await nomad.downloadHlsAudio(rec.audio_playlist_url!, audioPath)
    const duration = await probeDurationSeconds(audioPath)
    console.log(`  downloaded ${Math.round(duration / 60)} min of audio in ${Math.round((Date.now() - t0) / 1000)}s`)
    const waveform = await computeWaveform(audioPath)

    const roster = await loadRoster(rec.committee_id)
    const diarized = mergeSpeakerTurns(
      await diarizeAudio(
        backend,
        audioPath,
        duration,
        workDir,
        { prompt: transcriptionPrompt(rec.committee_name, roster), ...speakerCountHint(roster) },
        (m) => console.log(m),
      ),
    )

    const { identities, identified } = await identifyWithLogging(rec, roster, diarized)
    const { segments, speakers } = attributeSpeakers(diarized, identities, roster)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await saveTranscript(client, rec.id, segments, speakers)
      await client.query(
        `UPDATE hearing_recordings
         SET transcript_status = 'ready', transcript_source = 'diarized', waveform = $2,
             duration_seconds = $3, transcribed_at = now(), last_error = NULL, updated_at = now(),
             speakers_identified_at = CASE WHEN $4 THEN now() END,
             speaker_id_attempts = CASE WHEN $4 THEN 0 ELSE 1 END
         WHERE id = $1`,
        [rec.id, JSON.stringify(waveform), Math.round(duration), identified],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    console.log(`  diarized: ${segments.length} segments, ${describeSpeakers(speakers, identities.lines.length)}`)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

function describeSpeakers(speakers: SpeakerRow[], attributedLines: number): string {
  const named = speakers.filter((s) => s.label !== 'UNKNOWN' && !s.displayName.startsWith('Speaker ')).length
  return `${speakers.length} speakers (${named} named, ${attributedLines} lines attributed from their text)`
}

// The speaker names step. It returns `identified: false` if the step did
// not run or failed. In that case the transcript is kept without names, and
// retrySpeakerNames tries the names step again on a later run.
async function identifyWithLogging(
  rec: RecordingRow,
  roster: RosterEntry[],
  segments: DiarizedSegment[],
): Promise<{ identities: Awaited<ReturnType<typeof identifySpeakers>>; identified: boolean }> {
  const none = { speakers: [], lines: [] }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ANTHROPIC_API_KEY is not set. The speakers are stored without names.')
    return { identities: none, identified: false }
  }
  try {
    const identities = await identifySpeakers({ committeeName: rec.committee_name, recordedAt: rec.recorded_at, roster, segments })
    return { identities, identified: true }
  } catch (err) {
    console.warn(`  speaker identification failed: ${(err as Error).message}`)
    return { identities: none, identified: false }
  }
}

async function saveTranscript(client: PoolClient, recordingId: number, segments: DiarizedSegment[], speakers: SpeakerRow[]) {
  await replaceSegments(client, recordingId, segments)
  await client.query('DELETE FROM hearing_speakers WHERE recording_id = $1', [recordingId])
  for (const s of speakers) {
    await client.query(
      `INSERT INTO hearing_speakers (recording_id, label, display_name, legislator_id, role, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [recordingId, s.label, s.displayName, s.legislatorId, s.role, s.confidence],
    )
  }
}

// Speaker names for finished transcripts that do not have them. This needs
// only the stored segments and Claude, not the audio or the GPU, so it runs
// even when the transcription service is not available.
const SPEAKER_ID_MAX_ATTEMPTS = 3
const DEFAULT_NAMES_LIMIT = 4

async function retrySpeakerNames(limit: number, onlyRecording?: string): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return
  // With --recording, do the names step again even if the transcript has names.
  const { rows } = await pool.query<RecordingRow>(
    onlyRecording
      ? `SELECT * FROM hearing_recordings WHERE nomad_item_id = $1 AND transcript_source = 'diarized'`
      : `SELECT * FROM hearing_recordings
         WHERE transcript_source = 'diarized' AND transcript_status = 'ready'
           AND speakers_identified_at IS NULL AND speaker_id_attempts < $2
         ORDER BY recorded_at DESC LIMIT $1`,
    onlyRecording ? [onlyRecording] : [limit, SPEAKER_ID_MAX_ATTEMPTS],
  )
  if (rows.length === 0) return
  console.log(`${rows.length} transcript(s) without speaker names: running the names step again.`)

  for (const rec of rows) {
    console.log(`naming speakers: ${rec.committee_name} ${rec.recorded_at}...`)
    const { rows: stored } = await pool.query<{ start_seconds: number; end_seconds: number; speaker_label: string | null; text: string }>(
      `SELECT start_seconds, end_seconds, speaker_label, text FROM hearing_transcript_segments
       WHERE recording_id = $1 ORDER BY seq`,
      [rec.id],
    )
    const segments: DiarizedSegment[] = stored.map((s) => ({
      start: s.start_seconds,
      end: s.end_seconds,
      speaker: s.speaker_label ?? 'UNKNOWN',
      text: s.text,
    }))
    const roster = await loadRoster(rec.committee_id)
    const { identities, identified } = await identifyWithLogging(rec, roster, segments)
    if (!identified) {
      await pool.query('UPDATE hearing_recordings SET speaker_id_attempts = speaker_id_attempts + 1 WHERE id = $1', [rec.id])
      continue
    }
    const attributed = attributeSpeakers(segments, identities, roster)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await saveTranscript(client, rec.id, attributed.segments, attributed.speakers)
      await client.query(
        `UPDATE hearing_recordings SET speakers_identified_at = now(), speaker_id_attempts = 0, updated_at = now() WHERE id = $1`,
        [rec.id],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    console.log(`  ${describeSpeakers(attributed.speakers, identities.lines.length)}`)
  }
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2)
  const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  const sinceArg = arg('since')
  // Two windows: the job finds and captions recordings in the long window,
  // and fully transcribes recordings in the short window. --since sets both.
  const findSince = sinceArg ? `${sinceArg}T00:00:00` : windowStart(FIND_RECORDINGS_DAYS)
  const since = sinceArg ? `${sinceArg}T00:00:00` : windowStart(FULL_TRANSCRIPT_DAYS)
  const limit = Number(arg('limit') ?? DEFAULT_DIARIZE_LIMIT)
  const onlyRecording = arg('recording')
  const captionsOnly = args.includes('--captions-only')
  const namesOnly = args.includes('--names-only')
  const fallbackArg = arg('fallback-after-hours')
  const fallbackAfterHours = fallbackArg != null ? Number(fallbackArg) : null

  const { rows: lock } = await pool.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY])
  if (!lock[0].ok) {
    console.log('another transcribe-hearings run is in progress; exiting.')
    return
  }

  if (namesOnly) {
    await retrySpeakerNames(Number(arg('limit') ?? DEFAULT_NAMES_LIMIT), onlyRecording)
    return
  }

  if (!onlyRecording) {
    console.log(`discovering archived meetings since ${findSince.slice(0, 10)}...`)
    console.log(`${await discoverRecordings(findSince, since)} new recording(s) found.`)
  }

  const scope = onlyRecording
    ? { sql: 'nomad_item_id = $1', params: [onlyRecording] as unknown[] }
    : { sql: 'recorded_at >= $1', params: [since] as unknown[] }
  const captionScope = onlyRecording ? scope : { sql: 'recorded_at >= $1', params: [findSince] as unknown[] }

  const { rows: needCaptions } = await pool.query<RecordingRow>(
    `SELECT * FROM hearing_recordings
     WHERE ${captionScope.sql} AND transcript_source IS NULL AND caption_url IS NOT NULL
     ORDER BY recorded_at DESC`,
    captionScope.params,
  )
  for (const rec of needCaptions) {
    try {
      await ingestCaptions(rec)
    } catch (err) {
      console.warn(`  captions failed for ${rec.committee_name} ${rec.recorded_at}: ${(err as Error).message}`)
    }
  }

  if (captionsOnly) return
  // Before the transcription backend check: this step does not use the GPU.
  if (!onlyRecording) await retrySpeakerNames(DEFAULT_NAMES_LIMIT)

  const backend = transcribeBackend()
  const unavailable = await backendUnavailableReason(backend)
  if (unavailable) {
    console.warn(`${backend} transcription is not available (${unavailable}). This run does captions only.`)
    return
  }
  if (backend === 'whisperx') {
    await pool.query(
      `INSERT INTO job_heartbeats (name, last_seen_at, detail) VALUES ($1, now(), $2)
       ON CONFLICT (name) DO UPDATE SET last_seen_at = now(), detail = EXCLUDED.detail`,
      [WHISPERX_HEARTBEAT, process.env.WHISPERX_URL ?? null],
    )
  }
  if (fallbackAfterHours != null) {
    const { rows } = await pool.query<{ fresh: boolean }>(
      `SELECT last_seen_at > now() - make_interval(hours => $2) AS fresh FROM job_heartbeats WHERE name = $1`,
      [WHISPERX_HEARTBEAT, fallbackAfterHours],
    )
    if (rows[0]?.fresh) {
      console.log(`The WhisperX transcriber checked in within ${fallbackAfterHours}h. It does the transcription.`)
      return
    }
    console.log(`No WhisperX check-in within ${fallbackAfterHours}h. This run does the transcription as the fallback.`)
  }

  const { rows: needDiarize } = await pool.query<RecordingRow>(
    `SELECT * FROM hearing_recordings
     WHERE ${scope.sql} AND audio_playlist_url IS NOT NULL
       AND ${onlyRecording ? 'true' : `transcript_status IN ('pending', 'processing') AND attempts < ${MAX_ATTEMPTS}`}
     ORDER BY recorded_at DESC
     LIMIT ${onlyRecording ? 1 : limit}`,
    scope.params,
  )
  console.log(`${needDiarize.length} recording(s) to diarize this run (${backend}).`)
  for (const rec of needDiarize) {
    console.log(`diarizing ${rec.committee_name} ${rec.recorded_at}...`)
    try {
      await diarizeRecording(rec, backend)
    } catch (err) {
      const message = (err as Error).message
      console.error(`  failed: ${message}`)
      // Give up after MAX_ATTEMPTS; any caption segments stay in place.
      await pool.query(
        `UPDATE hearing_recordings
         SET attempts = attempts + 1, last_error = $2, updated_at = now(),
             transcript_status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE transcript_status END
         WHERE id = $1`,
        [rec.id, message.slice(0, 1000), MAX_ATTEMPTS],
      )
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
