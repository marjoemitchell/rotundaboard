// Local audio processing for the hearing transcription pipeline, all via
// the ffmpeg binary that ships with the ffmpeg-static npm package (so the
// Railway cron container doesn't need a system ffmpeg). Only ever pointed
// at local files — see downloadHlsAudio() in nomadClient.ts for why.
import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import type { Writable } from 'node:stream'
import ffmpegPath from 'ffmpeg-static'

// allowFailure: `ffmpeg -i file` with no output file exits 1 by design, but
// still prints the stream info we want to read off stderr.
function ffmpeg(
  args: string[],
  opts: { captureStdout?: boolean; allowFailure?: boolean } = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform')
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, ['-hide_banner', '-nostdin', ...args])
    const out: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      if (opts.captureStdout) out.push(d)
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0 || opts.allowFailure) resolve({ stdout: Buffer.concat(out), stderr })
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    })
  })
}

async function run(args: string[]): Promise<void> {
  const { stderr } = await ffmpeg(['-loglevel', 'error', '-y', ...args])
  if (stderr.trim()) console.warn(`ffmpeg: ${stderr.trim().slice(0, 300)}`)
}

export async function probeDurationSeconds(path: string): Promise<number> {
  const { stderr } = await ffmpeg(['-i', path], { allowFailure: true })
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) throw new Error(`could not read duration of ${path}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

const WAVEFORM_SAMPLE_RATE = 100
export const WAVEFORM_BARS = 160

/**
 * Relative loudness (0–1) in WAVEFORM_BARS equal time buckets — what the
 * player draws as its seek bar. Decoded at 100 Hz mono, which is plenty for
 * an RMS envelope and keeps a 5-hour hearing to ~3.5 MB of PCM.
 */
export async function computeWaveform(path: string): Promise<number[]> {
  const { stdout } = await ffmpeg(
    ['-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE), '-f', 's16le', '-'],
    { captureStdout: true },
  )
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2))
  if (samples.length === 0) return []
  const perBar = Math.max(1, Math.floor(samples.length / WAVEFORM_BARS))
  const rms: number[] = []
  for (let b = 0; b < WAVEFORM_BARS; b += 1) {
    const from = b * perBar
    const to = b === WAVEFORM_BARS - 1 ? samples.length : Math.min(samples.length, from + perBar)
    let sum = 0
    for (let i = from; i < to; i += 1) sum += samples[i] * samples[i]
    rms.push(to > from ? Math.sqrt(sum / (to - from)) : 0)
  }
  const max = Math.max(...rms) || 1
  return rms.map((v) => Math.round((v / max) * 100) / 100)
}

/**
 * The whole recording as 16 kHz mono 48 kbps AAC — the rate Whisper and
 * pyannote resample to anyway, and ~20 MB/hour to upload to the WhisperX
 * service (vs ~55 MB/hour for the archive's own audio).
 */
export async function encodeForTranscription(src: string, dest: string): Promise<void> {
  await run(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', dest])
}

/**
 * Cuts [startSeconds, startSeconds+durationSeconds) into a small mono AAC
 * file for the transcription API: 16 kHz / 48 kbps keeps a 20-minute chunk
 * around 7 MB, well under the 25 MB upload limit (the archive's own audio
 * is ~127 kbps, which would put a 20-minute chunk at ~19 MB).
 */
export async function cutChunk(src: string, dest: string, startSeconds: number, durationSeconds: number): Promise<void> {
  await run([
    '-ss', String(startSeconds), '-t', String(durationSeconds), '-i', src,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', dest,
  ])
}

/**
 * A short WAV clip as a data: URL — the format known_speaker_references
 * expects. Written to a temp file rather than piped: on a pipe ffmpeg can't
 * seek back to fill in the RIFF size fields, leaving them as 0xFFFFFFFF.
 */
export async function clipAsDataUrl(src: string, startSeconds: number, durationSeconds: number): Promise<string> {
  const dest = `${src}.ref-${Math.round(startSeconds * 1000)}.wav`
  try {
    await run(['-ss', String(startSeconds), '-t', String(durationSeconds), '-i', src, '-vn', '-ac', '1', '-ar', '16000', dest])
    return `data:audio/wav;base64,${(await readFile(dest)).toString('base64')}`
  } finally {
    await rm(dest, { force: true })
  }
}

/**
 * Spawns ffmpeg reading an MPEG-TS stream on stdin and writing only its
 * audio (stream-copied, no re-encode) to dest. Caller writes to `stdin`,
 * ends it, then awaits `done`.
 */
export function extractAudioFromStream(dest: string): { stdin: Writable; done: Promise<void> } {
  if (!ffmpegPath) throw new Error('ffmpeg-static has no binary for this platform')
  const proc = spawn(ffmpegPath as unknown as string, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'mpegts', '-i', 'pipe:0', '-vn', '-c:a', 'copy', '-f', 'mp4', dest,
  ])
  let stderr = ''
  proc.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-5000)
  })
  // If ffmpeg dies early, writes to stdin fail with EPIPE; surface the real
  // error through `done` instead of an unhandled stream error.
  proc.stdin.on('error', () => {})
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))))
  })
  return { stdin: proc.stdin, done }
}
