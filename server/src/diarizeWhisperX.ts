// TRANSCRIBE_BACKEND=whisperx: speaker-diarized transcription via our own
// WhisperX service (transcriber/ at the repo root), running on a GPU host
// next to this job. Unlike the OpenAI backend there's no upload size limit
// to chunk around, so the whole hearing goes up in one piece and pyannote
// diarizes it end to end — speaker labels (SPEAKER_00, ...) are consistent
// across the entire recording.
import 'dotenv/config'
import { openAsBlob } from 'node:fs'
import path from 'node:path'
import { encodeForTranscription } from './hearingAudio.js'
import type { DiarizedSegment, DiarizeOptions } from './diarize.js'

const POLL_INTERVAL_MS = 15_000
// A 7-hour hearing with large-v3 on a GTX 1660 Super should finish well
// inside this; past it, assume the service is stuck and let the run retry.
const JOB_TIMEOUT_MS = 4 * 60 * 60 * 1000
// A status check can fail transiently (the service is busy, a network
// blip); only give up on a job after this many failures in a row — ~2.5
// minutes at the poll interval — rather than discarding a transcription
// that may be nearly done.
const MAX_CONSECUTIVE_POLL_FAILURES = 10

interface JobStatus {
  status: 'queued' | 'running' | 'done' | 'failed'
  stage: string
  error: string | null
  result: { duration: number; segments: { start: number; end: number; speaker: string | null; text: string }[] } | null
}

function serviceUrl(): string {
  const url = process.env.WHISPERX_URL
  if (!url) throw new Error('WHISPERX_URL is not set')
  return url.replace(/\/+$/, '')
}

/** Null if the service is up and its GPU is usable; otherwise why not. */
export async function whisperxUnavailableReason(): Promise<string | null> {
  try {
    const res = await fetch(`${serviceUrl()}/health`, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { problems?: string[] }
    return body.problems?.join('; ') || `health check returned ${res.status}`
  } catch (err) {
    return `can't reach ${process.env.WHISPERX_URL}: ${(err as Error).message}`
  }
}

export async function diarizeWithWhisperX(
  audioPath: string,
  workDir: string,
  opts: DiarizeOptions,
  log: (msg: string) => void = console.log,
): Promise<DiarizedSegment[]> {
  const base = serviceUrl()
  const uploadPath = path.join(workDir, 'upload.m4a')
  await encodeForTranscription(audioPath, uploadPath)

  const form = new FormData()
  form.append('file', await openAsBlob(uploadPath), 'audio.m4a')
  if (opts.prompt) form.append('prompt', opts.prompt)
  if (opts.minSpeakers) form.append('min_speakers', String(opts.minSpeakers))
  if (opts.maxSpeakers) form.append('max_speakers', String(opts.maxSpeakers))
  const created = await fetch(`${base}/jobs`, { method: 'POST', body: form })
  if (!created.ok) throw new Error(`WhisperX job submit failed: ${created.status} ${await created.text()}`)
  const { id } = (await created.json()) as { id: string }

  const deadline = Date.now() + JOB_TIMEOUT_MS
  let lastStage = ''
  let pollFailures = 0
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      let job: JobStatus
      try {
        const res = await fetch(`${base}/jobs/${id}`, { signal: AbortSignal.timeout(30_000) })
        // 404 is definitive: the service restarted and its in-memory job is gone.
        if (res.status === 404) throw new LostJobError()
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
        job = (await res.json()) as JobStatus
        pollFailures = 0
      } catch (err) {
        if (err instanceof LostJobError) throw new Error('WhisperX lost the job (service restarted?)')
        pollFailures += 1
        log(`  whisperx: status check failed (${pollFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}): ${(err as Error).message}`)
        if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw new Error(`WhisperX job poll failed: ${(err as Error).message}`)
        continue
      }
      if (job.stage !== lastStage) {
        log(`  whisperx: ${job.stage}`)
        lastStage = job.stage
      }
      if (job.status === 'failed') throw new Error(`WhisperX job failed: ${job.error}`)
      if (job.status === 'done' && job.result) {
        return job.result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          // Words pyannote couldn't place (overlapping speech, silence edges).
          speaker: s.speaker ?? 'UNKNOWN',
          text: s.text,
        }))
      }
      if (Date.now() > deadline) throw new Error(`WhisperX job ${id} still ${job.status} after ${JOB_TIMEOUT_MS / 3_600_000}h`)
    }
  } finally {
    await fetch(`${base}/jobs/${id}`, { method: 'DELETE' }).catch(() => {})
  }
}

class LostJobError extends Error {}
