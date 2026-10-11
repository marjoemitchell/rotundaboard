// Speaker-diarized transcription backends, picked by TRANSCRIBE_BACKEND:
//   whisperx — our own WhisperX service on a GPU host (diarizeWhisperX.ts).
//              No per-hearing cost; the primary path.
//   openai   — OpenAI's gpt-4o-transcribe-diarize (diarizeOpenAI.ts). The
//              default, so the Railway cron keeps working as a paid fallback.
import { diarizeWithOpenAI } from './diarizeOpenAI.js'
import { diarizeWithWhisperX, whisperxUnavailableReason } from './diarizeWhisperX.js'

export interface DiarizedSegment {
  start: number
  end: number
  speaker: string
  text: string
}

export type TranscribeBackend = 'openai' | 'whisperx'

export interface DiarizeOptions {
  /** Whisper initial prompt (committee and member names). WhisperX only. */
  prompt?: string
  /** Speaker-count bounds for the diarizer. WhisperX only. */
  minSpeakers?: number
  maxSpeakers?: number
}

export function transcribeBackend(): TranscribeBackend {
  const value = (process.env.TRANSCRIBE_BACKEND ?? 'openai').toLowerCase()
  if (value !== 'openai' && value !== 'whisperx') {
    throw new Error(`TRANSCRIBE_BACKEND must be "openai" or "whisperx", got "${value}"`)
  }
  return value
}

/** Null if the configured backend can take work right now; otherwise why not. */
export async function backendUnavailableReason(backend: TranscribeBackend): Promise<string | null> {
  if (backend === 'openai') return process.env.OPENAI_API_KEY ? null : 'OPENAI_API_KEY is not set'
  if (!process.env.WHISPERX_URL) return 'WHISPERX_URL is not set'
  return whisperxUnavailableReason()
}

export function diarizeAudio(
  backend: TranscribeBackend,
  audioPath: string,
  durationSeconds: number,
  workDir: string,
  opts: DiarizeOptions,
  log: (msg: string) => void = console.log,
): Promise<DiarizedSegment[]> {
  return backend === 'whisperx'
    ? diarizeWithWhisperX(audioPath, workDir, opts, log)
    : diarizeWithOpenAI(audioPath, durationSeconds, workDir, log)
}
