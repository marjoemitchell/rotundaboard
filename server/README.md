# Data ingestion

All legislative data (bills, legislators, committees, votes, hearings/agendas)
comes from `bearbeta.legmt.gov`, an unpublished/beta JSON API belonging to the
Montana Legislature (see `src/legmtClient.ts`). There is no official published
schema for it — request shapes were reverse-engineered from live responses.

## Scripts

| Script | What it does | Cost |
|---|---|---|
| `npm run scrape` | Full pull: sessions, legislators, committees, bills for the target session | Slow — re-pulls every bill |
| `npm run scrape:details` | Per-bill detail pass (status history, votes, cosponsors, amendments) | Slow, concurrency-limited |
| `npm run refresh-meetings` | Interim-committee meeting times/locations/agendas only, for committees already in the DB | Fast — no bill data touched |
| `npm run generate-summaries` | AI-generated bill summaries | Only needs to run after new bills appear |
| `npm run transcribe-hearings` | Finds newly posted committee hearing videos, ingests their captions, and produces speaker-attributed transcripts | Discovery + captions are free; diarization is free on the self-hosted GPU (WhisperX) or ~$0.006/audio-minute on the OpenAI fallback, plus one Claude call per hearing for speaker names |

## Recommended cadence

**`refresh-meetings` needs to run periodically on its own** — committee
agendas get published by legislative staff a few days ahead of a meeting,
often after the meeting row itself already exists in our DB with an empty
`agenda_items` array. Without a recurring refresh, agendas silently go stale
(this happened in practice — see the interim-committee agenda gap fixed on
2026-09-06).

**Production (Railway)** runs this on Railway's own cron scheduler — see
`.railway/railway.ts` at the repo root for the `cron-refresh-meetings`
(every 6h), `cron-scrape` (daily), `cron-scrape-details` (daily), and
`cron-generate-summaries` (daily), and `cron-transcribe-hearings` (every 2h)
service definitions. That's the source of
truth for cadence; nothing local needs to run for the deployed app to stay
current.

**Local dev**: a systemd user timer doing the same thing against your local
Postgres is checked into `systemd/` in this directory, for whenever you want
your local DB to mirror production's freshness without deploying anything.
It's off by default — local dev data doesn't need to self-refresh the way
production does, so this is opt-in:

```sh
mkdir -p ~/.config/systemd/user
cp systemd/rotunda-refresh-meetings.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now rotunda-refresh-meetings.timer
```

Check status/logs with:

```sh
systemctl --user list-timers rotunda-refresh-meetings.timer
journalctl --user -u rotunda-refresh-meetings.service -n 50
```

If the machine isn't logged in continuously, run
`loginctl enable-linger $USER` once so the timer fires even without an active
session.

The full `scrape`/`scrape:details` pass is much heavier (re-pulls every bill)
and doesn't need a tight cadence — production runs it once daily; locally,
just run it manually when a new session starts or bill data seems stale.

## Hearing transcripts

Committee hearing video is **not** on the bearbeta API. The Legislature's
archive moved off SliQ Harmony to Nomad Media: `streaming-video.legmt.gov`
(public site), `streaming-api.legmt.gov/api/media/*` (unauthenticated JSON
— search + item detail), and `streaming-content.legmt.gov` (HLS + caption
files, no CORS headers). See `src/nomadClient.ts`.

`npm run transcribe-hearings` (`src/transcribeHearings.ts`) runs three passes:

1. **Discover** — searches the archive per interim committee, keeps items
   whose title parses as `<time>, <exact committee name>, <date>` and that
   have an archived asset (scheduled meetings point at a live-room stream
   instead), and matches them to `non_standing_committee_meetings` by
   committee + date.
2. **Captions** — ingests the archive's own live-caption `.vtt` as soon as it
   exists (`transcript_status = 'processing'`). These are lossy (~⅓ of words,
   no speakers) but free and immediate.
3. **Diarize** — downloads the audio, transcribes it with speaker
   diarization, has Claude match speaker labels to the committee roster /
   legislators, and replaces the captions (`transcript_status = 'ready'`).
   `TRANSCRIBE_BACKEND` picks the engine:
   - `whisperx` — our own WhisperX service on a GPU box
     (`transcriber/`, deployed with `deploy/unraid/` — see its README). The
     whole hearing goes up in one piece and pyannote diarizes it end to end.
     No per-hearing cost. This is the primary transcriber.
   - `openai` (default) — `gpt-4o-transcribe-diarize` in 20-minute chunks
     (speakers carried across chunks with reference clips). Needs
     `OPENAI_API_KEY`. Railway runs this only as a fallback:
     `--fallback-after-hours=6` skips it while the GPU box's heartbeat
     (`job_heartbeats`) is fresh.

   Speaker names need `ANTHROPIC_API_KEY` either way. Whisper is primed with
   the committee's member names to improve their spelling.

Freshly posted videos are the raw MPEG-TS recording with no captions or
audio-only rendition; the archive replaces them with a processed version
later (observed lag: weeks to months). The pipeline handles both — it strips
the audio from the raw stream locally — and pins a recording's stream URLs
once it's diarized, since transcript timestamps belong to that exact stream.

By default only recordings from the last 60 days are processed, and at most 4
are diarized per run. Backfill with `--since=YYYY-MM-DD` (and `--limit=N`);
reprocess one with `--recording=<nomad item id>`; `--captions-only` skips
diarization.

ffmpeg: the pipeline uses `FFMPEG_PATH` if set, else a system `ffmpeg` on
PATH, else the static binary from the `ffmpeg-static` npm package (its install
script must stay approved in `package.json` → `allowScripts`). Prefer a system
ffmpeg wherever you deploy — the Unraid job image installs Debian's, and the
Railway cron asks Railpack for one via `RAILPACK_DEPLOY_APT_PACKAGES` —
because ffmpeg-static's 7.0.2 segfaults probing some of the archive's raw
MPEG-TS recordings. Audio is always downloaded by Node first and ffmpeg only
ever reads local files (that static build also segfaults on network input).
