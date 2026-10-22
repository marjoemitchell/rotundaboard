import { test, expect, signUpFreshWorkspace, trackBillWithOutcome } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// The open draft fixtures show in the statewide suggestions of every
// workspace, so the tests of this file run in order.
test.describe.configure({ mode: 'serial' })

type Draft = { billId: string; identifier: string; title: string }

async function openDrafts(request: APIRequestContext, count: number): Promise<Draft[]> {
  const res = await request.post(`${API_BASE}/api/__test__/open-drafts`, { data: { count } })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).bills
}

async function track(request: APIRequestContext, billId: string) {
  const res = await request.post(`${API_BASE}/api/bills/${billId}/track`)
  expect(res.ok()).toBeTruthy()
}

const primary = (page: Page) => page.locator('[class*="_primary_"]')
const trackedTable = (page: Page) => page.getByRole('grid', { name: 'Tracked bills' })

// Text that must never show on the dashboard.
async function expectCleanCopy(page: Page) {
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/\b1 bills\b/)
  expect(text).not.toContain('0 fiscal notes')
  expect(text).not.toMatch(/\+0\b/)
  for (const line of text.split('\n')) expect(line.trim(), `"${line}"`).not.toMatch(/·$/)
}

test.describe('dashboard with few tracked bills', () => {
  test('one closed bill: setup, suggestions, coming up, and a collapsed "Closed" group', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const drafts = await openDrafts(page.request, 5)
    const { identifier } = await trackBillWithOutcome(page)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const setup = page.getByRole('region', { name: 'Get set up' })
    await expect(setup).toContainText('0 of 4')
    await expect(page.getByRole('region', { name: 'Suggested to track' })).toContainText(drafts[4].identifier)
    await expect(page.getByRole('region', { name: 'Coming up' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Moving now' })).toHaveCount(0)

    // The closed bill is in a collapsed group, with "—" for momentum.
    const closedToggle = trackedTable(page).getByRole('button', { name: /Closed · 1/ })
    await expect(closedToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(trackedTable(page).getByText(identifier, { exact: true })).toHaveCount(0)
    await closedToggle.click()
    const closedRow = trackedTable(page).getByRole('row').filter({ hasText: identifier })
    await expect(closedRow).toBeVisible()
    await expect(closedRow.getByLabel('No momentum: closed').first()).toHaveText('—')
    await expect(closedRow.getByText(/Became law|Died|Failed/)).toHaveCount(0)

    // The primary column is at least as tall as the rail.
    const heights = await page.evaluate(() => {
      const h = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0
      return { primary: h('[class*="_primary_"]'), rail: h('[class*="_rail_"]') }
    })
    expect(heights.primary).toBeGreaterThanOrEqual(heights.rail)
    await expectCleanCopy(page)
  })

  test('no tracked bills: no table, no filter bar, and no "Moving now"', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Get set up' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Coming up' })).toContainText(
      'Follow an interim committee to see its meetings here.',
    )
    await expect(trackedTable(page)).toHaveCount(0)
    await expect(page.getByLabel('Add filter')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Moving now' })).toHaveCount(0)
    await expectCleanCopy(page)
  })

  test('"Track" on a suggestion tracks the draft, and the setup steps update', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const drafts = await openDrafts(page.request, 3)
    await page.goto('/')
    const suggestions = page.getByRole('region', { name: 'Suggested to track' })
    const newest = drafts[0]
    await suggestions.getByRole('button', { name: `Track ${newest.identifier}` }).click()
    await expect(page.getByText(`Tracking ${newest.identifier}.`)).toBeVisible()
    await expect(suggestions.getByText(newest.identifier)).toHaveCount(0)
    await expect(trackedTable(page).getByText(newest.title)).toBeVisible()

    // One active bill with no position: "Show them" filters the table.
    const setup = page.getByRole('region', { name: 'Get set up' })
    await expect(setup).toContainText('1 of 5 active bills tracked.')
    await expect(setup).toContainText('1 tracked bill has no position.')
    await setup.getByRole('button', { name: 'Show them' }).click()
    await expect(page.getByLabel('Position', { exact: true })).toHaveValue('none')
    await expect(trackedTable(page).getByText(newest.title)).toBeVisible()
    // One bill: the footer says "View tracked bill", not "View all 1 tracked bills".
    await expect(page.getByRole('button', { name: 'View tracked bill →' })).toBeVisible()
    await expectCleanCopy(page)
  })

  test('"Coming up" lists followed committee meetings, with a badge for a tracked bill on the agenda', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page)
    const [draft] = await openDrafts(page.request, 1)
    await track(page.request, draft.billId)
    const res = await page.request.post(`${API_BASE}/api/__test__/committee-meeting`, {
      data: { daysFromNow: 5, agenda: [`Discussion of ${draft.identifier}`] },
    })
    const meeting = (await res.json()) as { committeeId: string; committee: string }
    await page.request.post(`${API_BASE}/api/committees/${meeting.committeeId}/follow`)

    await page.goto('/')
    const comingUp = page.getByRole('region', { name: 'Coming up' })
    const row = comingUp.locator('div', { hasText: meeting.committee }).filter({ hasText: '1 tracked bill' }).last()
    await expect(row).toBeVisible()
    await expect(row).toContainText('Room 102 (E2E)')
    await expect(comingUp.getByRole('link', { name: meeting.committee })).toHaveAttribute('href', `/committees/${meeting.committeeId}`)
    // The strip counts only meetings of the followed committees.
    await expect(page.getByText('None for committees that you follow')).toHaveCount(0)
  })
})

test.describe('dashboard with enough active bills', () => {
  test('5 active bills: the normal layout, with "Coming up" under the table', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const drafts = await openDrafts(page.request, 5)
    for (const d of drafts) await track(page.request, d.billId)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Moving now' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Get set up' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Suggested to track' })).toHaveCount(0)
    await expect(trackedTable(page).getByRole('row')).toHaveCount(6)
    // "Coming up" comes after the table in the primary column.
    const order = await primary(page).evaluate((el) => {
      const table = el.querySelector('[aria-label="Tracked bills"]')
      const coming = el.querySelector('[aria-label="Coming up"]')
      return table && coming ? table.compareDocumentPosition(coming) & Node.DOCUMENT_POSITION_FOLLOWING : 0
    })
    expect(order).toBeTruthy()
    await expectCleanCopy(page)
  })
})
