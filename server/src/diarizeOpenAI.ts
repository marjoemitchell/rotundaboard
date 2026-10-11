// TRANSCRIBE_BACKEND=openai: speaker-diarized transcription of a full
// hearing via OpenAI's gpt-4o-transcribe-diarize (Whisper-family ASR with
// speaker labels). Used by the Railway cron as a delayed fallback for the
// self-hosted WhisperX service (diarizeWhisperX.ts).
//
// The API takes at most 25 MB per request and labels speakers per request
// ("A", "B", ...), so a multi-hour hearing is cut into CHUNK_SECONDS pieces
// and speaker identity is carried across pieces with known_speaker_names /
// known_speaker_references: after each chunk, the busiest not-yet-known
// voices (up to the API's limit of 4) get a short reference clip and a
// stable label ("S1".."S4") that later chunks reuse. That reliably covers
// the chair and the most frequent speakers; everyone else keeps a
// chunk-scoped label like "3:B", and identifySpeakers.ts (Claude) can still
// map several such labels to the same person by name.
import 'dotenv/config'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'
import type { TranscriptionDiarized } from 'openai/resources/audio/transcriptions'
import { clipAsDataUrl, cutChunk } from './hearingAudio.js'
import type { DiarizedSegment } from './diarize.js'

const MODEL = 'gpt-4o-transcribe-diarize'
const CHUNK_SECONDS = 20 * 60
const MAX_KNOWN_SPEAKERS = 4
// known_speaker_references clips must be 2–10 s long.
const REFERENCE_MIN_SECONDS = 3
const REFERENCE_MAX_SECONDS = 8

interface KnownSpeaker {
  name: string
  reference: string
}

export async function diarizeWithOpenAI(
  audioPath: string,
  durationSeconds: number,
  workDir: string,
  log: (msg: string) => void = console.log,
): Promise<DiarizedSegment[]> {
  const openai = new OpenAI()
  const known: KnownSpeaker[] = []
  const all: DiarizedSegment[] = []
  const chunkCount = Math.max(1, Math.ceil(durationSeconds / CHUNK_SECONDS))

  for (let i = 0; i < chunkCount; i += 1) {
    const offset = i * CHUNK_SECONDS
    const chunkPath = path.join(workDir, `chunk-${i}.m4a`)
    await cutChunk(audioPath, chunkPath, offset, CHUNK_SECONDS)

    // Cast: the conditional known_speaker_* spread defeats the SDK's
    // response_format-based overload narrowing.
    const result = (await openai.audio.transcriptions.create({
      file: createReadStream(chunkPath),
      model: MODEL,
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
      language: 'en',
      ...(known.length > 0
        ? { known_speaker_names: known.map((k) => k.name), known_speaker_references: known.map((k) => k.reference) }
        : {}),
    })) as TranscriptionDiarized

    const knownNames = new Set(known.map((k) => k.name))
    const chunkSegments = result.segments
      .filter((s) => s.text.trim())
      .map((s) => ({
        start: s.start,
        end: s.end,
        // Known speakers come back under the name we gave them; anyone else
        // gets a letter that only means something within this chunk.
        speaker: knownNames.has(s.speaker) ? s.speaker : `${i + 1}:${s.speaker}`,
        text: s.text.trim(),
      }))
    log(`  chunk ${i + 1}/${chunkCount}: ${chunkSegments.length} segments`)

    if (known.length < MAX_KNOWN_SPEAKERS) {
      // Relabel this chunk's own segments too, so the chunk that introduced
      // a newly-promoted voice agrees with the chunks after it.
      const promoted = await addKnownSpeakers(known, chunkSegments, chunkPath)
      for (const seg of chunkSegments) seg.speaker = promoted.get(seg.speaker) ?? seg.speaker
    }

    for (const seg of chunkSegments) {
      all.push({ start: seg.start + offset, end: seg.end + offset, speaker: seg.speaker, text: seg.text })
    }
  }
  return all
}

async function addKnownSpeakers(
  known: KnownSpeaker[],
  segments: { start: number; end: number; speaker: string }[],
  chunkPath: string,
): Promise<Map<string, string>> {
  // chunk-scoped label ("2:B") -> stable name ("S3")
  const promoted = new Map<string, string>()
  const knownNames = new Set(known.map((k) => k.name))
  const talkTime = new Map<string, number>()
  for (const s of segments) {
    if (knownNames.has(s.speaker)) continue
    talkTime.set(s.speaker, (talkTime.get(s.speaker) ?? 0) + (s.end - s.start))
  }
  const candidates = [...talkTime.entries()].sort((a, b) => b[1] - a[1]).map(([speaker]) => speaker)

  for (const speaker of candidates) {
    if (known.length >= MAX_KNOWN_SPEAKERS) break
    // Longest single segment gives the cleanest single-voice sample.
    const best = segments
      .filter((s) => s.speaker === speaker && s.end - s.start >= REFERENCE_MIN_SECONDS)
      .sort((a, b) => b.end - b.start - (a.end - a.start))[0]
    if (!best) continue
    const length = Math.min(REFERENCE_MAX_SECONDS, best.end - best.start)
    // Start a little into the segment to skip any overlap with the previous speaker.
    const start = best.start + Math.min(0.5, (best.end - best.start - length) / 2)
    const reference = await clipAsDataUrl(chunkPath, start, length)
    const name = `S${known.length + 1}`
    known.push({ name, reference })
    promoted.set(speaker, name)
  }
  return promoted
}
