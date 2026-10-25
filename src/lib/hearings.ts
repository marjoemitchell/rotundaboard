import type { HearingSummary } from '../types'
import { formatClock, formatDate } from './format'

// Short, honest description of what transcript a hearing currently has.
// A recording older than the full transcript window keeps the captions only,
// so its label does not say "in progress".
export function transcriptStatusLabel(
  h: Pick<HearingSummary, 'transcriptStatus' | 'transcriptSource' | 'speakersNamed' | 'fullTranscript'>,
): string {
  switch (h.transcriptStatus) {
    case 'ready':
      return h.speakersNamed ? 'Speaker-attributed transcript' : 'Transcript · speakers not named yet'
    case 'processing':
      return h.fullTranscript ? 'Captions only · speaker transcript in progress' : 'Captions only'
    case 'failed':
      return h.transcriptSource === 'captions' ? 'Captions only' : 'Transcript unavailable'
    default:
      return h.fullTranscript ? 'Transcript in progress' : 'Video only, no transcript'
  }
}

// The copy that tells the user which recordings we keep and how. Keep the
// numbers the same as server/src/recordingWindows.ts.
export const RECORDINGS_POLICY = {
  findYears: 2,
  fullTranscriptDays: 60,
}

// What a transcript clip saves as a note: the quote (attributed when the
// speaker is known) and a source line pointing back to the exact moment.
export function clipToNote(
  clip: { startSeconds: number; endSeconds: number; text: string; speaker: string | null },
  hearing: Pick<HearingSummary, 'committee' | 'datetime'>,
): { body: string; sourceHearing: string } {
  return {
    body: clip.speaker ? `${clip.speaker}: “${clip.text}”` : clip.text,
    sourceHearing: `${hearing.committee}, ${formatDate(hearing.datetime)}, ${formatClock(clip.startSeconds)}–${formatClock(clip.endSeconds)}`,
  }
}
