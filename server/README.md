# Data ingestion

All legislative data (bills, legislators, committees, votes, hearings/agendas)
comes from `bearbeta.legmt.gov`, an unpublished/beta JSON API belonging to the
Montana Legislature (see `src/legmtClient.ts`). There is no official published
schema for it — request shapes were reverse-engineered from live responses.

## Scripts

| Script | What it does | Cost |
|---|---|---|
| `npm run scrape` | Full pull: sessions, legislators, committees, bills for the scraped sessions | Slow: pulls every bill again |
| `npm run scrape:details` | Per-bill detail pass (status history, votes, cosponsors, amendments) | Slow, concurrency-limited |
| `npm run refresh-meetings` | Interim-committee meeting times/locations/agendas only, for committees already in the DB | Fast — no bill data touched |
| `npm run refresh-hearings` | The bill hearing schedule of all standing committees in one paged search, then hearing alerts and reminders | Fast: about 8 requests for a full session |
| `npm run refresh-bill-texts` | The text of bill versions and amendments (PDF files from the document store), and an AI summary of each amendment | About 3 seconds for each bill. A run checks at most 300 bills (`--limit=N`). One Claude Haiku call for each new amendment |
| `npm run generate-summaries` | AI-generated bill summaries | Only needs to run after new bills appear |
| `npm run send-alert-digest` | Daily email digest of change alerts (immediate alerts are sent by the scrape scripts themselves) | Cheap — database only, plus one email per person |
| `npm run summarize-hearings` | An AI summary of each finished hearing transcript: overview, topics with times, decisions and next steps | One Claude Sonnet call for each hearing |
| `npm run transcribe-hearings` | Finds newly posted committee hearing videos, ingests their captions, and produces speaker-attributed transcripts | Discovery + captions are free; diarization is free on the self-hosted GPU (WhisperX) or ~$0.006/audio-minute on the OpenAI fallback, plus one Claude call per hearing for speaker names |

## Legislators map data

The legislators page (`/legislators`) is a county map. Each county lists the
current members of the House and Senate districts that cover part of it.

- `src/data/montanaCountyDistricts.json` has the districts of each county.
  `public/maps/montana-counties.json` has the county shapes for the map.
- `scripts/buildCountyDistricts.mjs` makes both files from the US Census
  district boundaries (TIGER/Line 2024) and the us-atlas county shapes. The
  file header tells how to run it. Run it again after Montana redistricts.
- The data also lists the counties of each district, the county with the
  largest part of the district's area first. The district link on a
  legislator page (`/legislators?district=senate-9`) pins that county.
- `GET /api/legislators/map` adds the current member of each district: a
  term that has started and not ended. When two terms are current (a member
  and the nominee for the next legislature), the serving legislature comes
  first.

## Scraped sessions

`src/scrapeSessions.ts` selects the sessions that the scrapers fetch:

- every session that has not ended (in progress or upcoming), and
- the session that ended most recently.

With this rule, the LC drafts of a new session arrive as soon as the
Legislature lists the session (for example 2027 in October 2026), and the
last session stays current while its final actions come in. `scrape`,
`scrape:details`, `refresh-hearings`, and `refresh-bill-texts` use the same
sessions.

To scrape other sessions, set `SCRAPE_SESSION_ORDINALS` to a list of session
ordinals, for example `20251` or `20251,20271`.

The alerts treat a status that is older than 7 days as history. The first
scrape of a session stores the full history of each draft, and that
history sends no alert emails.

## Recommended cadence

**`refresh-meetings` needs to run periodically on its own** — committee
agendas get published by legislative staff a few days ahead of a meeting,
often after the meeting row itself already exists in our DB with an empty
`agenda_items` array. Without a recurring refresh, agendas silently go stale
(this happened in practice — see the interim-committee agenda gap fixed on
2026-09-06).

**Production (Railway)** runs this on Railway's own cron scheduler — see
`.railway/railway.ts` at the repo root for the `cron-refresh-meetings`
(every 6h), `cron-refresh-hearings` (every hour), `cron-refresh-bill-texts` (every 2h), `cron-scrape` (daily), `cron-scrape-details` (daily), and
`cron-generate-summaries` (daily), `cron-transcribe-hearings` (every 2h), and `cron-summarize-hearings` (every hour)
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

### Hearing summaries

`npm run summarize-hearings` (`src/summarizeHearings.ts`) writes an AI
summary of each transcript with `transcript_status = 'ready'`. It waits for
the speaker names, for a maximum of 6 hours after the transcript is ready.
The summary has an overview, the topics with their start times, and the
decisions and next steps. The transcript page shows it above the transcript.

- The summary is in `hearing_recordings.ai_summary`. `ai_summary_basis` is
  the transcript version that the summary is for. When the transcript or the
  speaker names change, the next run makes a new summary.
- The model refers to transcript lines by number, and the job changes them
  to times in the recording.
- A run makes at most 5 summaries (`--limit=N`). Use `--recording=<id>`
  (`hearing_recordings.id`) to make one summary again. A hearing that fails
  3 times is not tried again (`ai_summary_attempts`, `ai_summary_error`).
- The job runs on Railway, not on the GPU host. It needs `ANTHROPIC_API_KEY`.

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

## Change alerts

`src/alerts.ts` emails workspace members when something they track, watch, or
follow changes: a new bill status, a new amendment, a bill hearing scheduled or
rescheduled, or a followed interim committee scheduling or moving a meeting.

It runs at the end of every scrape (`scrape`, `scrape:details`,
`refresh-meetings`, `refresh-hearings`) and once a day from
`send-alert-digest`:

1. **Detect** — every alertable row is recorded as a `change_events` row keyed
   by the Legislature's own id (`status:<id>`, `amendment:<id>`,
   `hearing:<id>:<time>`, `meeting:<id>:<time>`). Keys are unique, so the same
   change can never become two events however often scrapers rerun. The very
   first run records everything as a `baseline` and emails no one.
2. **Match** each new event to workspaces: tracked bills, subject watches (same
   subject/tag rule as the Watches page), followed committees.
3. **Queue** an `alert_deliveries` row per member (primary key = no duplicate
   alerts), skipping members whose delivery is off or who muted every source
   that matched (`alert_mutes`, set from Settings → Email alerts).
4. **Send** each person's unsent alerts as one email — right away for
   `immediate` (the default), or in the daily digest for `daily`.

Bill hearings have more rules:

- A hearing alert goes out right away, also for people who chose the daily
  digest, because a hearing can be only a few days away.
- A canceled meeting, a canceled hearing, or a bill that is no longer on the
  agenda (`committee_bill_hearings.removed_at`) gives a "Hearing canceled"
  alert. This occurs only if people got an alert for that hearing.
- A reminder goes out in the last 25 hours before a hearing, if the hearing
  was announced more than 6 hours before. People can turn reminders off in
  Settings → Email alerts (`notification_preferences.hearing_reminders`).
- Scraped meeting times are Montana time with no time zone, so the queries
  compare them with `now() AT TIME ZONE 'America/Denver'`.

Emails go through `src/auth/email.ts` (Resend), so the scrape crons and the
digest cron need `RESEND_API_KEY`, `APP_BASE_URL` (for links), and
`EMAIL_FROM_ADDRESS`. While Resend is in test mode it only delivers to the
account owner's own address; verify a sending domain before relying on alerts
for anyone else.

## Bill text

`src/refreshBillTexts.ts` gets the bill text from the Legislature's document
store (`bearbeta.legmt.gov/docs/v1`). The store finds the files of a bill by
the legislature ordinal (69), the session ordinals (20251), the bill type, and
the bill number.

- Version files are `SB0001_1.pdf` (introduced), `SB0001_2.pdf`, and so on, and
  `SB0001_X.pdf` (enrolled). The store has copies such as `SB0001_2(3).pdf`.
  The job keeps the newest copy of each version in `bill_text_versions`.
- Amendment files are the bill text with the amendment in it
  (`SB0001.001.005_Amendments-in-Context_final-full.pdf`: version 1,
  amendment 5). The job compares each one with the version that it changes,
  and keeps only the changed paragraphs in `amendment_documents`.
- `src/billText.ts` extracts the text. The PDF draws strikethrough and
  underline as lines, so the extraction finds them by their position on the
  text. Struck text is removed from current law, and underlined text is new.
- The comparison ignores the case of letters. Text that a chamber adds by
  amendment is in capital letters in the next version only.
- Claude Haiku writes a summary of each amendment from the changed
  paragraphs. The alert for a new amendment waits for this summary, for a
  maximum of 12 hours.

## Scrape health checks

`src/scrapeHealth.ts` checks each run of `scrape`, `scrape:details`,
`refresh-meetings`, `refresh-hearings`, and `refresh-bill-texts`, because the data comes from an unpublished API that can
change with no notice.

- Each response from `bearbeta.legmt.gov` (and the committee pages from
  `legmt.gov`) is checked against `src/legmtShapes.ts`. That file lists the
  fields that the scrapers read. A missing field or a field with the wrong
  type is an error.
- The item count for each endpoint is compared with the previous good run.
  A count that falls by more than half, or an endpoint that returns no items,
  is an error. More than 10% failed requests is an error.
- Field names that appear or disappear between runs are a warning.
- Each run is saved in `scrape_runs`. The maintainer (`MAINTAINER_EMAIL`)
  gets one email when the problems change, and one email when the errors
  stop.
- The API server runs a check every hour. It sends an alert if a job has no
  successful run in its expected time (30 hours for the daily scrapes, 8
  hours for `refresh-meetings`, 4 hours for `refresh-hearings`, 8 hours for `refresh-bill-texts`). This finds a cron that stopped.
- The dashboard shows when the data was last updated (`/api/data-freshness`).

When the API changes on purpose, update `src/legmtShapes.ts` and
`src/legmtTypes.ts` together.
