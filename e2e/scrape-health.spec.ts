import { test, expect, signUpFreshWorkspace, uniqueSuffix } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// The freshness display reads the newest runs of the real job names, so the
// tests in this file add runs in order. No other spec adds scrape runs.
// A real "scrape" run in the dev database in the last 40 hours makes the
// "old data" test fail, because that real run is newer than the fixture.
test.describe.configure({ mode: 'serial' })

type RunResult = { status: string; problems: { id: string; severity: string; message: string }[]; alerted: boolean }

// One bill with the fields that the scraper reads (see legmtShapes.ts).
function bill(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sessionId: 2,
    billNumber: id,
    draft: { id, draftNumber: `LC${id}`, sessionId: 2, billStatuses: [], subjects: [] },
    ...overrides,
  }
}
const bills = (n: number, overrides?: Record<string, unknown>) => Array.from({ length: n }, (_, i) => bill(i + 1, overrides))

async function simulate(request: APIRequestContext, job: string, alertTo: string, items: unknown[]): Promise<RunResult> {
  const res = await request.post(`${API_BASE}/api/__test__/scrape-health/simulate`, {
    data: { job, alertTo, responses: [{ endpoint: 'bills', items }] },
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

async function lastEmail(request: APIRequestContext, to: string) {
  const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(to)}`)
  return res.ok() ? ((await res.json()) as { subject: string; html: string; sentAt: number }) : null
}

async function addRun(request: APIRequestContext, job: string, status: string, hoursAgo: number) {
  const res = await request.post(`${API_BASE}/api/__test__/scrape-run`, { data: { job, status, hoursAgo } })
  expect(res.ok()).toBeTruthy()
}

test.describe('scrape health alerts', () => {
  test('a schema change or an empty response emails the maintainer once, then again when it recovers', async ({ request }) => {
    const job = `e2e-scrape-${uniqueSuffix()}`
    const maintainer = `e2e-maintainer-${uniqueSuffix()}@example.dev`

    const good = await simulate(request, job, maintainer, bills(25))
    expect(good.status).toBe('ok')
    expect(await lastEmail(request, maintainer)).toBeNull()

    // Schema change: a field that the scraper reads is gone.
    const changed = await simulate(request, job, maintainer, bills(25, { draft: { id: 1, sessionId: 2, billStatuses: [], subjects: [] } }))
    expect(changed.status).toBe('failed')
    const first = await lastEmail(request, maintainer)
    expect(first?.subject).toContain('problem')
    expect(first?.html).toContain('draft.draftNumber')

    // The same problem again: no second email.
    await simulate(request, job, maintainer, bills(25, { draft: { id: 1, sessionId: 2, billStatuses: [], subjects: [] } }))
    expect((await lastEmail(request, maintainer))?.sentAt).toBe(first?.sentAt)

    // Empty response: a different problem, so a new email.
    const empty = await simulate(request, job, maintainer, [])
    expect(empty.problems.map((p) => p.id)).toContain('empty:bills')
    const second = await lastEmail(request, maintainer)
    expect(second?.sentAt).not.toBe(first?.sentAt)
    expect(second?.html).toContain('returned no items')

    // Good data again: one "working again" email.
    expect((await simulate(request, job, maintainer, bills(25))).status).toBe('ok')
    expect((await lastEmail(request, maintainer))?.subject).toContain('working again')
  })

  test('an alert that could not be sent is sent on the next run', async ({ request }) => {
    const job = `e2e-scrape-${uniqueSuffix()}`
    const maintainer = `e2e-maintainer-${uniqueSuffix()}@example.dev`
    const broken = bills(25, { draft: { id: 1, sessionId: 2, billStatuses: [], subjects: [] } })
    await simulate(request, job, maintainer, bills(25))

    // No address (as when MAINTAINER_EMAIL is not set yet): nothing is sent.
    const unsent = await simulate(request, job, '', broken)
    expect(unsent.status).toBe('failed')
    expect(unsent.alerted).toBe(false)

    // The same problem on the next run: the alert is sent now.
    const retried = await simulate(request, job, maintainer, broken)
    expect(retried.alerted).toBe(true)
    expect((await lastEmail(request, maintainer))?.html).toContain('draft.draftNumber')
  })

  test('a large drop in the item count is an error', async ({ request }) => {
    const job = `e2e-scrape-${uniqueSuffix()}`
    const maintainer = `e2e-maintainer-${uniqueSuffix()}@example.dev`
    await simulate(request, job, maintainer, bills(100))
    const dropped = await simulate(request, job, maintainer, bills(30))
    expect(dropped.status).toBe('failed')
    expect(dropped.problems.map((p) => p.id)).toContain('drop:bills')
    expect((await lastEmail(request, maintainer))?.html).toContain('fell from 100 to 30')
  })
})

test.describe('data freshness on the dashboard', () => {
  test('old data shows a warning, and the schedule check emails the maintainer', async ({ page }) => {
    await addRun(page.request, 'scrape', 'ok', 40)
    await addRun(page.request, 'scrape:details', 'ok', 1)
    await addRun(page.request, 'refresh-meetings', 'ok', 1)
    await addRun(page.request, 'refresh-hearings', 'ok', 1)
    await addRun(page.request, 'refresh-bill-texts', 'ok', 1)

    await signUpFreshWorkspace(page)
    const freshness = page.getByLabel('Data freshness')
    await expect(freshness).toHaveText(/^Legislature data may be out of date\. Last successful update \w{3} \d+, .+ \(2d ago\)\.$/)

    const maintainer = `e2e-maintainer-${uniqueSuffix()}@example.dev`
    const res = await page.request.post(`${API_BASE}/api/__test__/scrape-health/check-staleness`, { data: { alertTo: maintainer } })
    expect(res.ok()).toBeTruthy()
    const email = await lastEmail(page.request, maintainer)
    expect(email?.subject).toContain('the "scrape" schedule')
  })

  test('recent data shows when it was updated', async ({ page }) => {
    await addRun(page.request, 'scrape', 'ok', 1)
    await addRun(page.request, 'scrape:details', 'ok', 1)
    await addRun(page.request, 'refresh-meetings', 'ok', 1)
    await addRun(page.request, 'refresh-hearings', 'ok', 1)
    await addRun(page.request, 'refresh-bill-texts', 'ok', 1)

    await signUpFreshWorkspace(page)
    await expect(page.getByLabel('Data freshness')).toHaveText('Legislature data updated 1h ago.')
  })

  test('a failed update shows a warning', async ({ page }) => {
    // Finished now, so that it is newer than any real run in the dev database.
    await addRun(page.request, 'refresh-meetings', 'failed', 0)

    await signUpFreshWorkspace(page)
    const freshness = page.getByLabel('Data freshness')
    await expect(freshness).toContainText(/The last data update failed\. Last successful update .+ \(1h ago\)\./)
    // Retry checks the data freshness again.
    await freshness.getByRole('button', { name: 'Retry' }).click()
    await expect(freshness.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
})
