import type { HearingSummary } from '../types'
import { formatClock, formatDate } from './format'

// Short, honest description of what transcript a hearing currently has.
export function transcriptStatusLabel(
  h: Pick<HearingSummary, 'transcriptStatus' | 'transcriptSource' | 'speakersNamed'>,
): string {
  switch (h.transcriptStatus) {
    case 'ready':
      return h.speakersNamed ? 'Speaker-attributed transcript' : 'Transcript · speakers not named yet'
    case 'processing':
      return 'Captions only · speaker transcript in progress'
    case 'failed':
      return h.transcriptSource === 'captions' ? 'Captions only' : 'Transcript unavailable'
    default:
      return 'Transcript in progress'
  }
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
