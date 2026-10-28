import { defineConfig, devices } from '@playwright/test'

// Full e2e coverage against the real dev stack (Vite + Express + Postgres) —
// no mocking, since the whole point is exercising real workspace-scoped
// queries/mutations end to end. Tests create their own throwaway workspaces
// (see e2e/fixtures.ts) rather than relying on the seeded demo data, so runs
// are self-contained and safe to repeat; globalTeardown sweeps anything an
// interrupted run left behind.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run api',
      cwd: './server',
      // The tests read emails from the API's in-memory copy (GET
      // /api/__test__/last-email). Do not send them through Resend: its
      // test mode refuses the e2e addresses, and a refused email counts as
      // not sent (scrapeHealth.ts sends a not-sent alert again).
      // New workspaces get the organization plan (no limits), so that the
      // specs of paid features need no extra step. The plan specs set the
      // plan that they test (setWorkspacePlan in e2e/fixtures.ts).
      env: { RESEND_API_KEY: '', NEW_WORKSPACE_PLAN: 'organization' },
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
