// Writes an AI summary of each finished hearing transcript: an overview,
// the topics with the time that each one starts, and the decisions and next
// steps. The transcript page shows the summary (issue #13).
//
// A run summarizes the newest transcripts that have no summary, or that
// changed after their summary. A transcript is ready for a summary when:
//   - its status is "ready" (the diarized transcript, not the live captions),
//   - and the speakers have names, or the names step had 6 hours to finish.
// The model refers to transcript lines by number. This job changes the line
// numbers to times in the recording.
//
// Usage:
//   npm run summarize-hearings
//   npm run summarize-hearings -- --limit=2            # at most 2 hearings
//   npm run summarize-hearings -- --recording=<id>     # one hearing (hearing_recordings.id), again
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { pool } from './db.js'

export const SUMMARY_MODEL = 'claude-sonnet-5-5'
const DEFAULT_LIMIT = 5
const MAX_ATTEMPTS = 3
// A different key from transcribeHearings.ts (7_340_018) and alerts.ts (7_340_020).
const ADVISORY_LOCK_KEY = 7_340_021
// About 250,000 tokens. A longer transcript is cut at this length.
const MAX_TRANSCRIPT_CHARS = 1_000_000

const SYSTEM_PROMPT = `You summarize transcripts of Montana Legislature committee hearings for policy staff who track legislation.

The transcript comes from automatic speech recognition. Each line has a number (#12), the time in the recording, and the speaker. A speaker can be "Speaker N" when the name is not known. Names and numbers can have recognition errors: use the spelling that the context supports.

Return:
- overview: 2 to 4 sentences. Tell what the hearing was about and the most important results.
- topics: the agenda items or subjects, in the order of the hearing. For each topic, give a short title, 1 to 3 sentences about what was said or presented (who presented, the main points, the questions), and the number of the line where the topic starts. Include bill numbers and LC numbers when people say them. Use 3 to 15 topics. Do not make a topic for roll call, breaks, or other procedure.
- actions: the votes, motions, decisions, and next steps (for example, staff to bring a draft to the next meeting). Give the result of a vote when the transcript says it. Give the number of the line where it occurs. Use an empty list if there are none.

Use only information from the transcript. Be neutral. Do not say whether a position is good or bad.`

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          line: { type: 'integer' },
        },
        required: ['title', 'summary', 'line'],
        additionalProperties: false,
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          line: { type: ['integer', 'null'] },
        },
        required: ['text', 'line'],
        additionalProperties: false,
      },
    },
  },
  required: ['overview', 'topics', 'actions'],
  additionalProperties: false,
} as const

/** The summary as the database and the API store it. */
export interface HearingAiSummary {
  overview: string
  topics: { title: string; summary: string; startSeconds: number | null }[]
  actions: { text: string; startSeconds: number | null }[]
}

interface Candidate {
  id: number
  committee_name: string
  recorded_at: string
  basis: string
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function candidates(limit: number, recordingId: number | null): Promise<Candidate[]> {
  const { rows } = await pool.query<Candidate>(
    `SELECT r.id, r.committee_name, r.recorded_at,
            greatest(r.transcribed_at, r.speakers_identified_at) AS basis
     FROM hearing_recordings r
     WHERE r.transcript_status = 'ready'
       AND r.transcribed_at IS NOT NULL
       AND ($2::int IS NOT NULL AND r.id = $2
         OR $2::int IS NULL
            AND r.ai_summary_basis IS DISTINCT FROM greatest(r.transcribed_at, r.speakers_identified_at)
            AND r.ai_summary_attempts < $3
            AND (r.speakers_identified_at IS NOT NULL OR r.transcribed_at < now() - interval '6 hours'))
     ORDER BY r.recorded_at DESC
     LIMIT $1`,
    [limit, recordingId, MAX_ATTEMPTS],
  )
  return rows
}

async function summarize(client: Anthropic, recording: Candidate): Promise<HearingAiSummary> {
  const { rows: segments } = await pool.query<{ start_seconds: number; text: string; display_name: string | null }>(
    `SELECT s.start_seconds, s.text, sp.display_name
     FROM hearing_transcript_segments s
     LEFT JOIN hearing_speakers sp ON sp.recording_id = s.recording_id AND sp.label = s.speaker_label
     WHERE s.recording_id = $1
     ORDER BY s.seq`,
    [recording.id],
  )
  if (segments.length === 0) throw new Error('the transcript has no lines')

  let transcript = ''
  let cut = false
  for (const [i, s] of segments.entries()) {
    const line = `#${i} [${clock(s.start_seconds)}] ${s.display_name ?? 'Unknown speaker'}: ${s.text}\n`
    if (transcript.length + line.length > MAX_TRANSCRIPT_CHARS) {
      cut = true
      break
    }
    transcript += line
  }

  const response = await client.beta.messages.parse({
    model: SUMMARY_MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { format: betaJSONSchemaOutputFormat(OUTPUT_SCHEMA) },
    messages: [
      {
        role: 'user',
        content: [
          `Hearing: ${recording.committee_name}, ${recording.recorded_at.replace('T', ' ')}`,
          cut ? 'The transcript is long. Only the first part is here.' : '',
          '',
          '<transcript>',
          transcript,
          '</transcript>',
        ].join('\n'),
      },
    ],
  })
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`no usable output (stop_reason=${response.stop_reason})`)
  }

  // A line number that the model made up gets no time.
  const seconds = (line: number | null) =>
    line != null && Number.isInteger(line) && line >= 0 && line < segments.length ? segments[line].start_seconds : null
  const out = response.parsed_output
  return {
    overview: out.overview.trim(),
    topics: out.topics.map((t) => ({ title: t.title.trim(), summary: t.summary.trim(), startSeconds: seconds(t.line) })),
    actions: out.actions.map((a) => ({ text: a.text.trim(), startSeconds: seconds(a.line) })),
  }
}

function parseArgs() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  return { limit: Number(arg('limit') ?? DEFAULT_LIMIT), recordingId: arg('recording') ? Number(arg('recording')) : null }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set: no hearing summaries.')
    return
  }
  // One run at a time. A summary of a long hearing can take minutes.
  const lockClient = await pool.connect()
  try {
    const { rows } = await lockClient.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY])
    if (!rows[0].ok) {
      console.log('another summarize-hearings run is in progress')
      return
    }
    const { limit, recordingId } = parseArgs()
    const list = await candidates(limit, recordingId)
    // See identifySpeakers.ts: an API key that is not scoped to a workspace
    // needs the workspace header.
    const client = new Anthropic({
      defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
        ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
        : undefined,
    })
    let done = 0
    for (const recording of list) {
      try {
        const summary = await summarize(client, recording)
        await pool.query(
          `UPDATE hearing_recordings
           SET ai_summary = $2, ai_summary_model = $3, ai_summarized_at = now(), ai_summary_basis = $4,
               ai_summary_attempts = 0, ai_summary_error = NULL
           WHERE id = $1`,
          [recording.id, JSON.stringify(summary), SUMMARY_MODEL, recording.basis],
        )
        done += 1
        console.log(`summarized hearing ${recording.id} (${recording.committee_name}): ${summary.topics.length} topics`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await pool.query(
          `UPDATE hearing_recordings SET ai_summary_attempts = ai_summary_attempts + 1, ai_summary_error = $2 WHERE id = $1`,
          [recording.id, message.slice(0, 1000)],
        )
        console.error(`summary failed for hearing ${recording.id}:`, message)
      }
    }
    console.log(`summarized ${done} of ${list.length} hearings`)
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined)
    lockClient.release()
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
