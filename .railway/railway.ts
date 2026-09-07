import { defineRailway, empty, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("db");
  const repo = github("marjoemitchell/rotundaboard", { branch: "main" });

  // The 4 cron services deliberately do NOT use `repo` as their source.
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
      EMAIL_FROM_ADDRESS: "onboarding@resend.dev",
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

  return project("rotundaboard", {
    resources: [db, api, web, cronRefreshMeetings, cronScrape, cronScrapeDetails, cronGenerateSummaries],
  });
});
