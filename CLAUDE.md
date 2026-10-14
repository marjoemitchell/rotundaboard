# Rotunda Board

Rotunda Board is a bill-tracking tool for policy staff who follow the Montana Legislature.
It shows bills, committees, hearings, and legislators from the Legislature's public data.
Each team works in its own workspace and tracks bills, sets positions, writes notes and testimony, and gets alerts.

## Writing rules

These rules apply to all text that you write: tickets, issue comments, pull requests, commit messages, code comments, and documentation.

- Do not use em dashes (the long dash). Use a period, a comma, a colon, or parentheses.
  Do not use en dashes in text either. In a number range, write "to" (for example, "7 to 8 am").
- Write tickets, pull requests, and code comments in ASD-STE100 Simplified Technical English:
  - Use short sentences. Use a maximum of 20 words in an instruction and 25 words in a description.
  - Write one instruction in each sentence. Write one topic in each paragraph.
  - Use the active voice. Use the imperative for instructions ("Run the migration.").
  - Use one word for one meaning. Use the same term for the same thing every time.
  - Use simple verb tenses: simple present, simple past, and simple future.
  - Use articles ("the", "a") where English grammar needs them. Do not omit them to make text shorter.
  - Do not use slang, idioms, or vague words such as "basically" or "just".
  - Use a vertical list for three or more steps or conditions.
- Existing code comments do not follow these rules yet. When you change a comment, make it follow the rules.
  Do not make a separate change only to rewrite old comments.

## Repository layout

- `src/`: the React frontend (Vite, TypeScript, CSS modules).
- `server/`: the Express API, the data scrapers, and the batch jobs (TypeScript, run with `tsx`).
- `server/migrations/`: numbered SQL migrations. `npm run migrate` applies the new ones in order.
- `e2e/`: the Playwright end-to-end tests. `e2e/fixtures.ts` has the shared test helpers.
- `transcriber/`: the WhisperX transcription service (Python). It runs on a GPU host, not on Railway.
- `deploy/unraid/`: the Docker Compose stack for the GPU host.
- `.railway/railway.ts`: the Railway infrastructure. This file is the source of truth for services, crons, and variables.

## Commands

Run the frontend commands in the repository root:

```sh
npm run dev                       # Vite dev server on http://localhost:5173
npm run typecheck                 # frontend type check
npm run test:e2e -- --workers=4   # full end-to-end suite
```

Run the server commands in `server/`:

```sh
npm run api                  # API on http://localhost:4000
npm run migrate              # apply new SQL migrations
npm run typecheck            # server type check
npm run seed                 # demo workspace (dev only, password "password123")
npm run scrape               # full scrape of the target session
npm run scrape:details       # votes, amendments, and hearings for each bill
npm run refresh-meetings     # interim committee meetings and materials
npm run refresh-hearings     # bill hearing schedule, hearing alerts
npm run refresh-bill-texts   # bill version and amendment text, amendment summaries
npm run transcribe-hearings  # find hearing videos and make transcripts
npm run send-alert-digest    # daily digest of change alerts
```

The API reads `server/.env`. See `server/.env.example` for the variables.

## Testing rules

- All feature work must include end-to-end (e2e) tests. This rule has no exceptions.
  - Write the Playwright specs in `e2e/` in the same change as the feature. Do not put them in a later change.
  - The specs must test the behavior that the user sees, not only the API.
  - A bug fix must include a spec that fails without the fix.
- Run the full suite before you say that work is complete.
- Use `--workers=4`. With the default worker count, tests fail because the machine runs out of browser resources.
- Some tests are not stable even at 4 workers: the multi-user tests in `workspace-management` and `workspace-and-invites`, and the command palette test. An occasional timeout in these tests is not a regression.
  A failure that occurs on every run, or a "Target crashed" error, is a real problem.
- Each test makes its own workspace and users. Workspace names start with `E2E ` and emails start with `e2e-`.
  `server/src/e2eCleanup.ts` deletes these rows after each run. Do not use the seeded demo data in tests.
- Test-only API routes are under `/api/__test__/`. The server does not mount them when `NODE_ENV=production`.
- Playwright starts the API with an empty `RESEND_API_KEY`, so tests never send real email. If an API server is already running on port 4000, Playwright uses it, so stop your dev API before you run the suite.

## Data rules

- Scraped `TIMESTAMP` columns hold naive Montana wall-clock time, not UTC. `server/src/db.ts` returns them as strings.
  Do not convert them to `Date` with a time zone. Columns with real UTC times use `TIMESTAMPTZ`.
- Scraped rows use the Legislature's own ids as primary keys. The scrapers upsert, so ids stay the same between runs.
- Workspace data (tracked bills, notes, tags, watches, testimony) has a `workspace_id`.
  Every query for workspace data must filter on the workspace of the current session.
- Scraped data and hearing recordings are shared by all workspaces.

## Data sources

- Bills, legislators, and committees: `bearbeta.legmt.gov`, an unpublished JSON API (`server/src/legmtClient.ts`).
- Bill version and amendment text: PDF files in the document store of the same API (`docs/v1`). See "Bill text" in `server/README.md`.
- Committee meeting materials: the `legmt.gov` WordPress site.
- Hearing video: the Nomad Media archive at `streaming-video.legmt.gov` (`server/src/nomadClient.ts`).
  The media CDN sends no CORS headers. The browser plays hearing audio through the API proxy at `/api/hearings/:id/audio/`.

## Deployment

- Railway runs the API, the web frontend, Postgres, and the cron jobs.
- Change `.railway/railway.ts`, then run `railway config plan` and `railway config apply`.
  Read the plan before you apply it.
- The cron services do not deploy from GitHub. After a change to a cron script, run `railway up` for each cron service.
- Shared values (`APP_BASE_URL`, `RESEND_API_KEY`, and the Anthropic key and workspace id) are Railway shared variables.
  Services reference them as `${{shared.NAME}}`.
- Hearing transcription runs on a GPU host with the stack in `deploy/unraid/`. That host writes to the production database.
  The Railway transcription cron is a fallback. It runs only when the GPU host has not sent a heartbeat for 6 hours.
- Resend is in test mode. It sends email only to the account owner until a sending domain is verified.

## Email

- Send email with `sendLayoutEmail` in `server/src/auth/email.ts`. It uses the shared layout in `server/src/emailLayout.ts` and adds a plain-text version.
- Escape all user text in email HTML with `escapeHtml` (workspace names, bill titles, and other data).
- The sender is the Railway shared variable `EMAIL_FROM_ADDRESS`. The address must be on a domain that is verified in Resend.

## Scrape health

- `server/src/scrapeHealth.ts` checks each scrape run and emails `MAINTAINER_EMAIL` when a check fails.
- `server/src/legmtShapes.ts` lists the API fields that the scrapers read. When you change a scraper to read a new field, add the field there too.
- When the API changes, update `legmtShapes.ts` and `legmtTypes.ts` together.

## Known problems

- The `ffmpeg-static` binary crashes on some raw hearing recordings. The code uses a system `ffmpeg` when one is installed.
- Change alerts record a silent baseline on the first run. The first run sends no email. This is correct behavior.
