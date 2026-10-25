// How far back the transcription job keeps hearing recordings.
//
// The job finds the archived video of every interim committee meeting in the
// last FIND_RECORDINGS_DAYS (about one interim). It ingests the captions of
// the archive for each recording, which is free. Only recordings from the
// last FULL_TRANSCRIPT_DAYS get the full transcript with speaker names, which
// uses the GPU host and the AI speaker identification.
export const FIND_RECORDINGS_DAYS = 730
export const FULL_TRANSCRIPT_DAYS = 60

/** The naive Montana wall-clock start of a window, "YYYY-MM-DDT00:00:00". */
export function windowStart(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00'
}
