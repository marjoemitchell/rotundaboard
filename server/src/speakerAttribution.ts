// Turning diarized segments + Claude's identifications into the transcript
// lines and speaker rows we store. Pure functions (no DB, no network) so
// they can be exercised directly — see transcribeHearings.ts for the
// pipeline that calls them.
import type { DiarizedSegment } from './diarize.js'
import { MIN_CONFIDENCE, type LineIdentity, type RosterEntry, type SpeakerIdentity } from './identifySpeakers.js'

// Diarized segments are often single sentences; merge a speaker's
// consecutive ones into readable turns, capped so each line stays a
// sensible clip length.
const TURN_MAX_GAP_SECONDS = 1.5
const TURN_MAX_SECONDS = 45
// ...but never fold a very short utterance into a neighbour. Roll-call
// answers ("Here.") are about a second of audio — too little for the
// diarizer to fingerprint a voice, so they often land in the wrong cluster,
// sometimes the same one as the clerk calling the names. Kept as their own
// lines, the text can still say who answered (see LineIdentity).
const SHORT_UTTERANCE_SECONDS = 3

export function mergeSpeakerTurns(segments: DiarizedSegment[]): DiarizedSegment[] {
  const merged: DiarizedSegment[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.speaker === seg.speaker &&
      seg.start - last.end <= TURN_MAX_GAP_SECONDS &&
      seg.end - last.start <= TURN_MAX_SECONDS &&
      seg.end - seg.start >= SHORT_UTTERANCE_SECONDS &&
      last.end - last.start >= SHORT_UTTERANCE_SECONDS
    ) {
      last.end = Math.max(last.end, seg.end)
      last.text = `${last.text} ${seg.text}`
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}

export function legislatorTitle(chamber: string | null): string {
  if (chamber === 'SENATE') return 'Sen. '
  if (chamber === 'HOUSE') return 'Rep. '
  return ''
}

// Whisper's initial prompt: biases recognition toward the right spellings
// of the committee's name and its members' names, which are otherwise the
// words it gets most wrong (and the ones speaker identification relies on).
export function transcriptionPrompt(committeeName: string, roster: RosterEntry[]): string {
  const members = roster
    .filter((r) => r.committeeRole)
    .map((r) => `${r.chamber === 'SENATE' ? 'Senator' : r.chamber === 'HOUSE' ? 'Representative' : ''} ${r.name}`.trim())
  return `Montana Legislature, ${committeeName}. ${members.length ? `Members: ${members.join(', ')}.` : ''}`.trim()
}

/**
 * Bounds for the diarizer's speaker count. Left alone, pyannote tends to
 * under-count in a committee room (many voices through the same mics) and
 * merges people. Every member who attends is a distinct voice, so at least
 * half the committee is a safe floor; the ceiling leaves room for staff,
 * agency presenters, and public commenters.
 */
export function speakerCountHint(roster: RosterEntry[]): { minSpeakers?: number; maxSpeakers?: number } {
  const members = roster.filter((r) => r.committeeRole).length
  if (members === 0) return {}
  return { minSpeakers: Math.max(2, Math.ceil(members / 2)), maxSpeakers: members + 25 }
}

export interface SpeakerRow {
  label: string
  displayName: string
  legislatorId: number | null
  role: string | null
  confidence: number | null
}

/**
 * Final speaker for every transcript line, plus the speaker rows to store.
 *
 * Two layers, line-level winning:
 *  - voice clusters: each diarized label named as a whole when Claude is
 *    confident, else "Speaker N";
 *  - individual lines whose words alone prove who's talking (a roll-call
 *    answer right after the clerk calls a name, "for the record, my name
 *    is…"). These get their own label per person ("id:<legislatorId>" or
 *    "name:<name>"), overriding whatever voice cluster the line fell into —
 *    which is exactly the case where clustering is least reliable.
 */
export function attributeSpeakers(
  segments: DiarizedSegment[],
  identities: { speakers: SpeakerIdentity[]; lines: LineIdentity[] },
  roster: RosterEntry[],
): { segments: DiarizedSegment[]; speakers: SpeakerRow[] } {
  const rosterById = new Map(roster.map((r) => [r.legislatorId, r]))
  const nameFor = (name: string | null, legislatorId: number | null): { displayName: string; legislatorId: number | null } | null => {
    const legislator = legislatorId != null ? rosterById.get(legislatorId) : undefined
    if (legislator) return { displayName: `${legislatorTitle(legislator.chamber)}${legislator.name}`, legislatorId: legislator.legislatorId }
    return name?.trim() ? { displayName: name.trim(), legislatorId: null } : null
  }

  // Line-level overrides.
  const lineRows = new Map<string, SpeakerRow>()
  const lineLabelByIndex = new Map<number, string>()
  for (const line of identities.lines) {
    if (line.confidence < MIN_CONFIDENCE || line.line < 0 || line.line >= segments.length) continue
    const who = nameFor(line.name, line.legislatorId)
    if (!who) continue
    const label = who.legislatorId != null ? `id:${who.legislatorId}` : `name:${who.displayName.toLowerCase()}`
    lineLabelByIndex.set(line.line, label)
    const existing = lineRows.get(label)
    if (!existing || (existing.confidence ?? 0) < line.confidence) {
      lineRows.set(label, { label, ...who, role: who.legislatorId != null ? 'legislator' : null, confidence: line.confidence })
    }
  }
  const finalSegments = segments.map((s, i) => {
    const override = lineLabelByIndex.get(i)
    return override ? { ...s, speaker: override } : { ...s }
  })

  // Voice-cluster labels still in use, in order of first appearance.
  const byLabel = new Map(identities.speakers.map((i) => [i.label, i]))
  const rows: SpeakerRow[] = []
  let unknownCount = 0
  for (const label of new Set(finalSegments.map((s) => s.speaker))) {
    const lineRow = lineRows.get(label)
    if (lineRow) {
      rows.push(lineRow)
      continue
    }
    if (label === 'UNKNOWN') {
      rows.push({ label, displayName: 'Unidentified speaker', legislatorId: null, role: 'unknown', confidence: null })
      continue
    }
    const id = byLabel.get(label)
    const who = id && id.confidence >= MIN_CONFIDENCE ? nameFor(id.name, id.legislatorId) : null
    if (!who) {
      unknownCount += 1
      rows.push({ label, displayName: `Speaker ${unknownCount}`, legislatorId: null, role: id?.role ?? null, confidence: id?.confidence ?? null })
      continue
    }
    rows.push({ label, ...who, role: id!.role, confidence: id!.confidence })
  }
  return { segments: finalSegments, speakers: rows }
}
