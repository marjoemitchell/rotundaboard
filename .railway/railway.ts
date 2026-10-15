import { defineRailway, empty, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("db");
  const repo = github("marjoemitchell/rotundaboard", { branch: "main" });

  // The cron services deliberately do NOT use `repo` as their source.
  // Discovered 2026-09-07: connecting them to GitHub meant every push to
  // main (for completely unrelated api/web work) rebuilt and redeployed
  // them, and their cronSchedule silently stopped actually firing —
  // confirmed by zero deployment records across ~13 hours spanning 4
  // scheduled fires, even though `railway status` kept reporting a
  // plausible next-run time throughout. Disconnecting them from GitHub
  // (source: empty()) and deploying manually via `railway up`/`redeploy`
  // whenever their scripts actually change removes the confounding
  // variable. A cron/batch job doesn't need continuous deployment on
  // every commit the way a live service does, so this is the right
  // architecture regardless of the exact platform mechanism at fault.

  // EMAIL_FROM_ADDRESS is a Railway shared variable, for example
  // "Rotunda Board <alerts@rotundaboard.com>". The address must be on a domain
  // that is verified in Resend. Each service that sends email references it
  // as ${{shared.EMAIL_FROM_ADDRESS}}.
  // Real secrets (Anthropic/Resend keys) and environment-specific URLs are
  // declared here as preserve() so `config apply` never overwrites or wipes
  // them — the actual values are set once via `railway variables set` after
  // the services exist (domains aren't known until then anyway), and stay
  // untouched by future applies of this file.
  const api = service("api", {
    source: repo,
    root: "server",
    deploy: {
      startCommand: "npm run api",
      preDeployCommand: ["npm run migrate"],
      healthcheckPath: "/api/health",
    },
    networking: { serviceDomains: { default: {} } },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      APP_BASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
      // Gets the scrape health alerts. The API runs the hourly check for
      // scrape jobs that stopped (src/scrapeHealth.ts).
      MAINTAINER_EMAIL: preserve(),
    },
  });

  const web = service("web", {
    source: repo,
    deploy: {
      startCommand: "npx vite preview --host 0.0.0.0 --port $PORT",
    },
    networking: { serviceDomains: { default: {} } },
    env: {
      // Deliberately not setting VITE_API_BASE_URL: the frontend proxies
      // /api same-origin (see vite.config.ts + API_PROXY_TARGET below), and
      // client.ts's own DEV/PROD-aware default handles that when the var is
      // absent. An explicitly empty value doesn't survive to the Vite
      // build on this host, so leaving it unset is the correct state, not
      // an oversight.
      API_PROXY_TARGET: preserve(),
    },
  });

  const cronRefreshMeetings = service("cron-refresh-meetings", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run refresh-meetings",
      cronSchedule: "0 */6 * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      // Change alerts go out at the end of each scrape (src/alerts.ts).
      APP_BASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
      // Gets an email when a scrape health check fails (src/scrapeHealth.ts).
      MAINTAINER_EMAIL: preserve(),
    },
  });

  // The hearing schedule for all standing committees (src/refreshHearings.ts).
  // Each run sends hearing alerts and reminders, so it runs every hour.
  // Offset to :15 so it does not start together with the other crons.
  const cronRefreshHearings = service("cron-refresh-hearings", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run refresh-hearings",
      cronSchedule: "15 * * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      APP_BASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
      MAINTAINER_EMAIL: preserve(),
    },
  });

  const cronScrape = service("cron-scrape", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run scrape",
      cronSchedule: "0 8 * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      // Change alerts go out at the end of each scrape (src/alerts.ts).
      APP_BASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
      // Gets an email when a scrape health check fails (src/scrapeHealth.ts).
      MAINTAINER_EMAIL: preserve(),
    },
  });

  const cronScrapeDetails = service("cron-scrape-details", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run scrape:details",
      cronSchedule: "0 9 * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      // Change alerts go out at the end of each scrape (src/alerts.ts).
      APP_BASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
      // Gets an email when a scrape health check fails (src/scrapeHealth.ts).
      MAINTAINER_EMAIL: preserve(),
    },
  });

  const cronGenerateSummaries = service("cron-generate-summaries", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run generate-summaries",
      cronSchedule: "0 10 * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      ANTHROPIC_API_KEY: preserve(),
      ANTHROPIC_WORKSPACE_ID: preserve(),
    },
  });

  // Bill version and amendment text, and the amendment summaries
  // (src/refreshBillTexts.ts). Each run checks at most 300 bills, so the first
  // runs for a session fill in the text over several hours. Offset to :45.
  const cronRefreshBillTexts = service("cron-refresh-bill-texts", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run refresh-bill-texts",
      cronSchedule: "45 */2 * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      ANTHROPIC_API_KEY: preserve(),
      ANTHROPIC_WORKSPACE_ID: preserve(),
      APP_BASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
      MAINTAINER_EMAIL: preserve(),
    },
  });

  // AI summaries of finished hearing transcripts (src/summarizeHearings.ts).
  // The GPU host writes the transcripts. This cron only reads them, so it
  // runs here. Offset to :50.
  const cronSummarizeHearings = service("cron-summarize-hearings", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run summarize-hearings",
      cronSchedule: "50 * * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      ANTHROPIC_API_KEY: preserve(),
      ANTHROPIC_WORKSPACE_ID: preserve(),
    },
  });

  // Daily digest of change alerts for people on 'daily' delivery (immediate
  // alerts go out from the scrape crons above). 14:00 UTC is 7–8am in
  // Montana, after the overnight scrapes.
  const cronSendAlertDigest = service("cron-send-alert-digest", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run send-alert-digest",
      cronSchedule: "0 14 * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      APP_BASE_URL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM_ADDRESS: preserve(),
    },
  });

  // Hearing transcription (see server/src/transcribeHearings.ts). The
  // primary transcriber is self-hosted WhisperX on a GPU box (deploy/unraid/),
  // which writes to this same database. This cron is the fallback: it still
  // discovers recordings and ingests captions every run, but only pays for
  // OpenAI diarization when the GPU box hasn't checked in for 6h
  // (--fallback-after-hours) — leaving ample margin on the 24h target. A pg
  // advisory lock keeps it from overlapping the GPU box's runs. Offset to
  // :30 so it doesn't start alongside cron-refresh-meetings.
  const cronTranscribeHearings = service("cron-transcribe-hearings", {
    source: empty(),
    root: "server",
    deploy: {
      startCommand: "npm run transcribe-hearings -- --fallback-after-hours=6",
      cronSchedule: "30 */2 * * *",
      restartPolicyType: "NEVER",
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NODE_ENV: "production",
      OPENAI_API_KEY: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      ANTHROPIC_WORKSPACE_ID: preserve(),
      // A system ffmpeg for the pipeline to prefer over ffmpeg-static's
      // bundled build, which segfaults on some raw archive recordings (see
      // server/src/hearingAudio.ts). Read by Railpack, Railway's builder.
      RAILPACK_DEPLOY_APT_PACKAGES: "ffmpeg",
    },
  });

  return project("rotundaboard", {
    resources: [
      db,
      api,
      web,
      cronRefreshMeetings,
      cronRefreshHearings,
      cronRefreshBillTexts,
      cronSummarizeHearings,
      cronScrape,
      cronScrapeDetails,
      cronGenerateSummaries,
      cronTranscribeHearings,
      cronSendAlertDigest,
    ],
  });
});
