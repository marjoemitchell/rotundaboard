import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill, findSessionIdWithBills, type FreshWorkspace } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// Alert runs process every pending change in the database, so keep this
// file's runs from interleaving. No other spec creates changes or runs alerts.
test.describe.configure({ mode: 'serial' })

type AlertRun = { baseline: boolean; newEvents: number; queued: number; emails: number; alerts: number }

// Stand-ins for "a scrape just ran": record a fake status change on a bill,
// then run the alert pipeline the scrapers call at the end of each run.
async function scrapeStatusChange(request: APIRequestContext, billId: string) {
  const res = await request.post(`${API_BASE}/api/__test__/status-change`, { data: { billId } })
  expect(res.ok()).toBeTruthy()
}

async function runAlerts(request: APIRequestContext, digest = false): Promise<AlertRun> {
  const res = await request.post(`${API_BASE}/api/__test__/alerts/run`, { data: { digest } })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

// The last email captured for an address (any kind), or null.
async function lastEmail(request: APIRequestContext, to: string) {
  const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(to)}`)
  return res.ok() ? ((await res.json()) as { subject: string; html: string; sentAt: number }) : null
}

async function untrackedBill(page: Page, notId: string): Promise<{ id: string; identifier: string }> {
  const sessionId = await findSessionIdWithBills(page)
  const bills = await page.evaluate(
    async ({ apiBase, sessionId }) =>
      (await (await fetch(`${apiBase}/api/sessions/${sessionId}/bills`, { credentials: 'include' })).json()) as {
        id: string
        identifier: string
      }[],
    { apiBase: API_BASE, sessionId },
  )
  const bill = bills.find((b) => b.id !== notId)
  if (!bill) throw new Error('no second bill available')
  return bill
}

// The very first alert run in a fresh database only records a baseline, so
// make sure that's happened before any test relies on a change being "new".
test.beforeAll(async ({ request }) => {
  await runAlerts(request)
})

const alertsSection = (page: Page) => page.getByRole('region', { name: 'Email alerts' })

test.describe('alert settings', () => {
  test('delivery mode and per-source switches save and persist', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const [subject] = (await (await page.request.get(`${API_BASE}/api/subject-codes`)).json()) as { code: string }[]
    const watch = await page.request.post(`${API_BASE}/api/subject-watches`, {
      data: { name: 'E2E Water watch', subjectCodes: [subject.code], tagIds: [] },
    })
    expect(watch.ok()).toBeTruthy()

    await page.goto('/settings')
    const section = alertsSection(page)
    await expect(section.getByRole('radio', { name: /Right away/ })).toBeChecked()
    await expect(section.getByRole('checkbox', { name: 'Tracked bills' })).toBeChecked()
    await expect(section.getByRole('checkbox', { name: 'E2E Water watch' })).toBeChecked()
    await expect(section.locator('text=Not following any committees')).toBeVisible()

    await section.getByRole('radio', { name: /Daily digest/ }).check()
    await expect(section.getByRole('status')).toHaveText('Saved')
    await section.getByRole('checkbox', { name: 'E2E Water watch' }).uncheck()
    await expect(section.getByRole('status')).toHaveText('Saved')

    await page.reload()
    await expect(section.getByRole('radio', { name: /Daily digest/ })).toBeChecked()
    await expect(section.getByRole('checkbox', { name: 'E2E Water watch' })).not.toBeChecked()
    await expect(section.getByRole('checkbox', { name: 'Tracked bills' })).toBeChecked()

    // Off disables the per-source switches.
    await section.getByRole('radio', { name: /^Off/ }).check()
    await expect(section.getByRole('checkbox', { name: 'Tracked bills' })).toBeDisabled()
  })
})

test.describe('alert emails', () => {
  test('a status change on a tracked bill emails the member once, and muting tracked bills stops it', async ({ page }) => {
    const user: FreshWorkspace = await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackFirstAvailableBill(page)

    await scrapeStatusChange(page.request, billId)
    const run = await runAlerts(page.request)
    expect(run.queued).toBeGreaterThanOrEqual(1)

    const email = await lastEmail(page.request, user.email)
    expect(email?.subject).toMatch(/update/)
    expect(email?.html).toContain(identifier)
    expect(email?.html).toContain('Tracked bill')
    expect(email?.html).toContain(`/bills/${billId}`)

    // Re-running with nothing new must not send it again.
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(email?.sentAt)

    // Muted: a further change on the same bill sends nothing.
    await page.goto('/settings')
    await alertsSection(page).getByRole('checkbox', { name: 'Tracked bills' }).uncheck()
    await expect(alertsSection(page).getByRole('status')).toHaveText('Saved')
    await scrapeStatusChange(page.request, billId)
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(email?.sentAt)
  })

  test('a status older than 7 days (history from the first scrape of a session) sends no alert', async ({ page }) => {
    const user: FreshWorkspace = await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page)

    const old = await page.request.post(`${API_BASE}/api/__test__/status-change`, { data: { billId, daysAgo: 30 } })
    expect(old.ok()).toBeTruthy()
    await runAlerts(page.request)
    expect(await lastEmail(page.request, user.email)).toBeNull()

    // A new status on the same bill still alerts.
    await scrapeStatusChange(page.request, billId)
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.subject).toMatch(/update/)
  })

  test('daily-digest members get nothing until the digest runs, then everything in one email', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackFirstAvailableBill(page)
    await page.goto('/settings')
    await alertsSection(page).getByRole('radio', { name: /Daily digest/ }).check()
    await expect(alertsSection(page).getByRole('status')).toHaveText('Saved')

    await scrapeStatusChange(page.request, billId)
    await scrapeStatusChange(page.request, billId)
    await runAlerts(page.request)
    expect(await lastEmail(page.request, user.email)).toBeNull()

    await runAlerts(page.request, true)
    const digest = await lastEmail(page.request, user.email)
    expect(digest?.subject).toMatch(/digest: 2 updates/)
    expect(digest?.html).toContain(identifier)

    // Already delivered: the next digest has nothing for this member.
    await runAlerts(page.request, true)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(digest?.sentAt)
  })

  test('a subject watch alerts on its matching bills, and can be turned off on its own', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    // Untracked bill, matched only through a watch on a tag it carries.
    const bill = await untrackedBill(page, '')
    const tag = await (await page.request.post(`${API_BASE}/api/bills/${bill.id}/tags`, { data: { name: 'e2e-alerts' } })).json()
    const watchName = 'E2E Tagged bills'
    const watch = await page.request.post(`${API_BASE}/api/subject-watches`, {
      data: { name: watchName, subjectCodes: [], tagIds: [String(tag.id)] },
    })
    expect(watch.ok()).toBeTruthy()

    await scrapeStatusChange(page.request, bill.id)
    await runAlerts(page.request)
    const email = await lastEmail(page.request, user.email)
    expect(email?.html).toContain(bill.identifier)
    expect(email?.html).toContain(`Watch: ${watchName}`)
    expect(email?.html).not.toContain('Tracked bill')

    await page.goto('/settings')
    await alertsSection(page).getByRole('checkbox', { name: watchName }).uncheck()
    await expect(alertsSection(page).getByRole('status')).toHaveText('Saved')
    await scrapeStatusChange(page.request, bill.id)
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(email?.sentAt)
  })
})
