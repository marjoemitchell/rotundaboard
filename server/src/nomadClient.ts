// Client for the Montana Legislature's committee video archive. The state
// moved off SliQ Harmony to Nomad Media: the public site is
// streaming-video.legmt.gov (an Angular SPA), backed by a JSON API at
// streaming-api.legmt.gov whose /api/media/* routes need no auth, with media
// files on streaming-content.legmt.gov (CloudFront, no CORS headers — which
// is why the browser player goes through our API's audio proxy instead of
// hitting it directly).
//
// Endpoints in use (found by watching the SPA's own network traffic):
//   POST /api/media/search   {pageOffset, pageSize, searchQuery} -> items
//   GET  /api/media/item/:id -> one item, incl. video HLS + caption .vtt URLs
import 'dotenv/config'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import type { Writable } from 'node:stream'
import { extractAudioFromStream } from './hearingAudio.js'

const API_BASE = process.env.NOMAD_API_BASE ?? 'https://streaming-api.legmt.gov'
const USER_AGENT = 'RotundaBoard/0.1 (bill-tracking research tool; contact: rotundaboard project)'

export interface NomadSearchResult {
  itemId: string
  contentDefinition: { description: string; id: string }
  title: string
  duration?: number
}

export interface NomadItem {
  itemId: string
  contentDefinition: { description: string; id: string }
  title: string
  duration?: number
  video?: { assetId?: string; fullHlsUrl?: string; liveOutputStatus?: number }
  subtitles?: { id: string; fullUrl: string; title: string; language: string; isDefault: boolean }[]
  committee?: { description: string; id: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

const SEARCH_PAGE_SIZE = 100

/** Full-text search; paginates until a short page. Returns every content type (meetings, committees, events). */
export async function search(query: string): Promise<NomadSearchResult[]> {
  const all: NomadSearchResult[] = []
  for (let offset = 0; ; offset += 1) {
    const page = await request<NomadSearchResult[]>('/api/media/search', {
      method: 'POST',
      body: JSON.stringify({ pageOffset: offset, pageSize: SEARCH_PAGE_SIZE, searchQuery: query }),
    })
    all.push(...page)
    if (page.length < SEARCH_PAGE_SIZE) return all
  }
}

export function getItem(itemId: string): Promise<NomadItem> {
  return request(`/api/media/item/${encodeURIComponent(itemId)}`)
}

export interface ParsedMeetingTitle {
  committeeName: string
  /** Naive Mountain wall-clock, "YYYY-MM-DDTHH:MM:00" — same convention as db.ts's TIMESTAMP parsing. */
  recordedAt: string
}

// Archive titles look like "10:30 AM, Revenue Interim Committee, 2/23/2026"
// — but staff type them by hand, so the date is sometimes zero-padded
// ("06/24/2026") and the colon is sometimes missing ("1000 AM").
const TITLE_PATTERN = /^\s*(\d{1,2}):?(\d{2})\s*([AP]M)\s*,\s*(.+?)\s*,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/i

export function parseMeetingTitle(title: string): ParsedMeetingTitle | null {
  const m = TITLE_PATTERN.exec(title)
  if (!m) return null
  const [, hh, mm, ampm, committeeName, month, day, year] = m
  let hour = Number(hh) % 12
  if (ampm.toUpperCase() === 'PM') hour += 12
  const pad = (n: string | number) => String(n).padStart(2, '0')
  return {
    committeeName,
    recordedAt: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(mm)}:00`,
  }
}

export interface Cue {
  start: number
  end: number
  text: string
}

function parseVttTime(t: string): number {
  const parts = t.trim().split(':').map(Number)
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = []
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((l) => l.includes('-->'))
    if (timingIndex === -1) continue
    const [start, end] = lines[timingIndex].split('-->').map((s) => parseVttTime(s.split(' ').filter(Boolean)[0] ?? s))
    const text = lines
      .slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text && Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text })
  }
  return cues
}

export async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return res.text()
}

/**
 * Picks the media playlist the pipeline (and the browser player) should pull
 * audio from. Two shapes exist in the archive:
 *  - processed recordings ("bitmovin-hls/"): fMP4, with a separate
 *    audio-only rendition (EXT-X-MEDIA TYPE=AUDIO) — use that.
 *  - freshly posted recordings ("hls/manifest-<timestamp>.m3u8"): the raw
 *    MPEG-TS recording, audio muxed into the video. No audio-only rendition
 *    exists until the archive finishes processing (which can take weeks), so
 *    fall back to the lowest-bandwidth variant and strip the video locally.
 */
export async function resolveAudioPlaylistUrl(masterUrl: string): Promise<string | null> {
  const master = await getText(masterUrl)
  const lines = master.split('\n').map((l) => l.trim())
  const audioLine = lines.find((l) => l.startsWith('#EXT-X-MEDIA:') && l.includes('TYPE=AUDIO'))
  const audioUri = audioLine?.match(/URI="([^"]+)"/)?.[1]
  if (audioUri) return new URL(audioUri, masterUrl).href

  let best: { url: string; bandwidth: number } | null = null
  lines.forEach((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'))
    const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/)?.[1] ?? Infinity)
    if (uri && (!best || bandwidth < best.bandwidth)) best = { url: new URL(uri, masterUrl).href, bandwidth }
  })
  return (best as { url: string } | null)?.url ?? null
}

/** Sum of EXTINF durations — the only duration source for freshly posted recordings. */
export async function playlistDurationSeconds(mediaPlaylistUrl: string): Promise<number> {
  const playlist = await getText(mediaPlaylistUrl)
  let total = 0
  for (const m of playlist.matchAll(/#EXTINF:([\d.]+)/g)) total += Number(m[1])
  return Math.round(total)
}

const DOWNLOAD_CONCURRENCY = 16
const SEGMENT_RETRIES = 3

async function fetchSegment(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (attempt >= SEGMENT_RETRIES) throw err
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

/**
 * Downloads an HLS media playlist's audio into one local file that ffmpeg
 * can read. Done in Node rather than by pointing ffmpeg at the URL because
 * the static ffmpeg build we ship (ffmpeg-static) segfaults on network
 * input — a known DNS-resolution problem in fully static glibc builds — and
 * because this gives us retries. Segments are fetched concurrently but
 * written strictly in order.
 *
 *  - fMP4 (init segment + .m4s fragments, already audio-only): the
 *    concatenation is itself a valid fragmented MP4, written straight to disk.
 *  - MPEG-TS (muxed video): piped through ffmpeg, keeping only the audio
 *    stream, so ~1 GB/hour of video never touches the disk.
 */
export async function downloadHlsAudio(playlistUrl: string, destPath: string): Promise<void> {
  const playlist = await getText(playlistUrl)
  const init = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
  const segments = playlist.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (segments.length === 0) throw new Error(`no segments in playlist ${playlistUrl}`)
  const urls = [...(init ? [init] : []), ...segments].map((u) => new URL(u, playlistUrl).href)

  if (init) {
    const out = createWriteStream(destPath)
    try {
      await writeSegmentsInOrder(urls, out)
    } finally {
      out.end()
      await once(out, 'close')
    }
    return
  }

  const extractor = extractAudioFromStream(destPath)
  try {
    await writeSegmentsInOrder(urls, extractor.stdin)
  } finally {
    extractor.stdin.end()
  }
  await extractor.done
}

async function writeSegmentsInOrder(urls: string[], out: Writable): Promise<void> {
  const pending = new Map<number, Promise<Buffer>>()
  let nextToStart = 0
  const startNext = () => {
    if (nextToStart < urls.length) {
      const p = fetchSegment(urls[nextToStart])
      // Awaited in order below; this just keeps an in-flight failure from
      // surfacing as an unhandled rejection if an earlier segment throws first.
      p.catch(() => {})
      pending.set(nextToStart, p)
      nextToStart += 1
    }
  }
  for (let i = 0; i < DOWNLOAD_CONCURRENCY; i += 1) startNext()
  for (let i = 0; i < urls.length; i += 1) {
    const buf = await pending.get(i)!
    pending.delete(i)
    startNext()
    if (!out.write(buf)) await once(out, 'drain')
  }
}
