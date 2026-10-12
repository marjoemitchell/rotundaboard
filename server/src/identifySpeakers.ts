// Maps diarized speaker labels ("SPEAKER_03", "S1", "3:B", ...) to real
// people using Claude: the committee roster plus the full legislator list
// is the candidate set, and the transcript itself carries the evidence
// (roll call, the chair recognizing "Senator X", witnesses stating their
// name for the record). Anything Claude isn't confident about stays an
// anonymous "Speaker N" — a wrong name on a quote is worse than no name.
//
// Besides naming whole labels, it names individual lines whose words prove
// who's speaking (LineIdentity) — mainly roll-call answers, which are too
// short for the diarizer to place reliably. speakerAttribution.ts applies
// both.
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import type { DiarizedSegment } from './diarize.js'

const MODEL = 'claude-opus-5-5'
// Below this, a match is shown as "Speaker N" rather than a name.
export const MIN_CONFIDENCE = 0.7

export interface RosterEntry {
  legislatorId: number
  name: string
  chamber: string | null
  /** Role on this committee ("Chair", "Member", ...) or null if not a member. */
  committeeRole: string | null
}

/** A single transcript line whose own text proves who said it. */
export interface LineIdentity {
  /** Index into the segments passed to identifySpeakers. */
  line: number
  name: string | null
  legislatorId: number | null
  confidence: number
}

export interface SpeakerIdentity {
  label: string
  name: string | null
  legislatorId: number | null
  role: 'chair' | 'vice_chair' | 'member' | 'legislator' | 'staff' | 'witness' | 'unknown'
  confidence: number
}

const SYSTEM_PROMPT = `You identify speakers in transcripts of Montana Legislature interim committee hearings for a legislative-tracking tool used by policy staff.

The transcript was produced by automatic speech recognition with speaker diarization. Each line starts with a speaker label. Most labels (e.g. "SPEAKER_03", "S1") are consistent across the whole hearing. Labels shaped like "3:B" are only consistent within one 20-minute section, so the same person can appear under several of them — identify each label independently. "UNKNOWN" marks speech the diarizer couldn't attribute; return it with name null.

Use only evidence in the transcript: roll call ("Senator Smith?" followed by "Here"), the chair recognizing someone ("Representative Jones, go ahead", "Thank you, Mr. Chair" in response), people introducing themselves ("For the record, my name is..."), legislative staff presenting reports, and witnesses giving public comment. The chair typically opens the meeting, calls roll, and recognizes every other speaker.

When a speaker is a legislator in the provided roster, return their legislatorId. Staff and witnesses are not in the roster — give their name only if they state it (or are clearly introduced), with legislatorId null. Speech recognition often mangles names, so match roster names by sound as well as spelling.

Calibrate confidence honestly: 0.9+ only when the transcript explicitly ties the name to that label; 0.7–0.9 for strong contextual evidence; below 0.7 when you are guessing. Return every label you were given, using name null and role "unknown" when there is no real evidence. A wrong attribution is much worse than an unknown one.

The diarizer places very short utterances badly, so a label can wrongly cover several people — most often during roll call, where each member answers "here" in about a second. So also return "lines": individual transcript lines (by their #number) whose speaker is proven by the words themselves, regardless of the line's label. Typical cases: a roll-call answer ("here", "present", "yes", "no", "aye") on the line right after the clerk or chair calls a specific name; a vote answer right after a name is called; a line where the speaker states their own name ("for the record, my name is…", "Representative Jones, for the record"). Only include a line when its text and the line before it make the speaker unambiguous — not because the line's label is attributed to someone. If a call and its answer are on the same line, skip it. Use the same legislatorId and confidence rules as above. Return an empty list if there are none.`

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    speakers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          name: { type: ['string', 'null'] },
          legislatorId: { type: ['integer', 'null'] },
          role: { type: 'string', enum: ['chair', 'vice_chair', 'member', 'legislator', 'staff', 'witness', 'unknown'] },
          confidence: { type: 'number' },
        },
        required: ['label', 'name', 'legislatorId', 'role', 'confidence'],
        additionalProperties: false,
      },
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer' },
          name: { type: ['string', 'null'] },
          legislatorId: { type: ['integer', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['line', 'name', 'legislatorId', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['speakers', 'lines'],
  additionalProperties: false,
} as const

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export async function identifySpeakers(params: {
  committeeName: string
  recordedAt: string
  roster: RosterEntry[]
  segments: DiarizedSegment[]
}): Promise<{ speakers: SpeakerIdentity[]; lines: LineIdentity[] }> {
  const labels = [...new Set(params.segments.map((s) => s.speaker))]
  if (labels.length === 0) return { speakers: [], lines: [] }

  const rosterLines = params.roster.map(
    (r) =>
      `${r.legislatorId}\t${r.name}\t${r.chamber ?? ''}\t${r.committeeRole ? `committee ${r.committeeRole}` : 'not on this committee'}`,
  )
  const transcriptLines = params.segments.map((s, i) => `#${i} [${s.speaker}] ${clock(s.start)} ${s.text}`)

  // Same as generateSummaries.ts: the SDK only auto-attaches
  // ANTHROPIC_WORKSPACE_ID for credential-file/OIDC auth, so an API key that
  // isn't scoped to a workspace needs the header set explicitly or every
  // request 400s.
  const client = new Anthropic({
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
      ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
      : undefined,
  })
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { effort: 'high', format: betaJSONSchemaOutputFormat(OUTPUT_SCHEMA) },
    messages: [
      {
        role: 'user',
        content: [
          `Hearing: ${params.committeeName}, ${params.recordedAt.replace('T', ' ')}`,
          `Speaker labels to identify: ${labels.join(', ')}`,
          '',
          '<roster>',
          'legislatorId\tname\tchamber\tcommittee role',
          ...rosterLines,
          '</roster>',
          '',
          '<transcript>',
          ...transcriptLines,
          '</transcript>',
        ].join('\n'),
      },
    ],
  })

  // An error, not an empty result: the job then tries the names step again
  // on a later run (see retrySpeakerNames in transcribeHearings.ts).
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`no usable output (stop_reason=${response.stop_reason})`)
  }

  const validIds = new Set(params.roster.map((r) => r.legislatorId))
  // Never trust an id the model made up.
  const checkedId = (id: number | null) => (id != null && validIds.has(id) ? id : null)
  const clamp = (c: number) => Math.max(0, Math.min(1, c))
  const wanted = new Set(labels)
  return {
    speakers: response.parsed_output.speakers
      .filter((s) => wanted.has(s.label))
      .map((s) => ({ label: s.label, name: s.name, legislatorId: checkedId(s.legislatorId), role: s.role, confidence: clamp(s.confidence) })),
    lines: response.parsed_output.lines
      .filter((l) => Number.isInteger(l.line) && l.line >= 0 && l.line < params.segments.length)
      .map((l) => ({ line: l.line, name: l.name, legislatorId: checkedId(l.legislatorId), confidence: clamp(l.confidence) })),
  }
}
