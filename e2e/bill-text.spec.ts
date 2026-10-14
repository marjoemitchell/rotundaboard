import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// Alert runs process every pending change, so run this file's tests in order.
test.describe.configure({ mode: 'serial' })

// A bill that the other specs do not use. The fixture replaces its text.
const TEXT_BILL = 9

type CapturedEmail = { subject: string; html: string; text: string | null; sentAt: number }

async function lastEmail(request: APIRequestContext, to: string): Promise<CapturedEmail | null> {
  const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(to)}`)
  return res.ok() ? res.json() : null
}

async function runAlerts(request: APIRequestContext) {
  const res = await request.post(`${API_BASE}/api/__test__/alerts/run`, { data: {} })
  expect(res.ok()).toBeTruthy()
}

// Two versions of the bill and one amendment (see billTextFixture in
// server/src/api/testFixtures.ts). Version 2 changes the fee from $40 to $35
// and adds a paragraph about veterans.
async function addBillText(
  request: APIRequestContext,
  billId: string,
  options: { summary?: string | null; amendmentAgeHours?: number } = {},
): Promise<{ amendmentNumber: number }> {
  const n = Math.floor(Math.random() * 400_000_000) + 1
  const res = await request.post(`${API_BASE}/api/__test__/bill-text`, {
    data: { billId: Number(billId), amendmentId: -n, documentId: -n * 4, ...options },
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

const SUMMARY = 'Lowers the new license fee from $40 to $35 and exempts veterans from the fee.'

test.beforeAll(async ({ request }) => {
  // The first alert run in an empty database only records a baseline.
  await runAlerts(request)
})

test.describe('bill text', () => {
  test('two versions of a bill can be compared in a redline view', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: TEXT_BILL })
    await addBillText(page.request, billId, { summary: SUMMARY })

    await page.goto(`/bills/${billId}`)
    const textSection = page.getByRole('region', { name: 'Bill text' })
    await expect(textSection.getByText('Introduced')).toBeVisible()
    await expect(textSection.getByText('Version 2')).toBeVisible()
    await textSection.getByRole('link', { name: 'Compare versions' }).click()

    await expect(page).toHaveURL(new RegExp(`/bills/${billId}/compare`))
    const redline = page.getByRole('region', { name: 'Redline' })
    await expect(redline.getByText('2 changed paragraphs')).toBeVisible()
    await expect(redline.locator('del')).toHaveText(['$40'])
    await expect(redline.locator('ins')).toHaveText(['$35', 'A veteran does not pay the fee.'])
    // The marks of the printed bill stay: $25 is struck (removed from current law).
    await expect(redline.getByText('$25')).toHaveCSS('text-decoration-line', 'line-through')
    // Unchanged paragraphs show only on request.
    await expect(redline.getByText('Section 1. Fees.')).toHaveCount(0)
    await page.getByLabel('Only changed paragraphs').uncheck()
    await expect(redline.getByText('Section 1. Fees.')).toBeVisible()

    // Any two versions: a version compared with itself has no changes.
    await page.getByLabel('From').selectOption('2')
    await expect(redline.getByText('No changes between these versions.')).toBeVisible()
    await expect(page).toHaveURL(/from=2&to=2/)
  })

  test('an amendment shows its plain-language summary and the text that it changes', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: TEXT_BILL })
    const { amendmentNumber } = await addBillText(page.request, billId, { summary: SUMMARY })

    await page.goto(`/bills/${billId}`)
    const amendment = page.getByTestId('amendment').filter({ hasText: `Amendment #${amendmentNumber}` })
    await expect(amendment.getByText(SUMMARY)).toBeVisible()
    await expect(amendment.getByText('to Introduced')).toBeVisible()
    await expect(page.getByText('Summaries are AI-generated from the amendment text.')).toBeVisible()

    await amendment.getByRole('button', { name: 'Show the changes' }).click()
    const changes = amendment.getByRole('region', { name: `Changes of Amendment #${amendmentNumber}` })
    await expect(changes.locator('ins')).toHaveText(['$35', 'A veteran does not pay the fee.'])
    await expect(changes.locator('del')).toHaveText(['$40'])
  })
})

test.describe('amendment alerts', () => {
  test('the alert for a new amendment includes the summary', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: TEXT_BILL })
    const { amendmentNumber } = await addBillText(page.request, billId, { summary: SUMMARY })
    await runAlerts(page.request)

    const email = await lastEmail(page.request, user.email)
    expect(email?.html).toContain(`New amendment #${amendmentNumber}`)
    expect(email?.html).toContain(SUMMARY)
    expect(email?.text).toContain(SUMMARY)
  })

  test('the alert waits for the summary, but not more than 12 hours', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: TEXT_BILL })

    // No summary yet: no alert.
    const { amendmentNumber } = await addBillText(page.request, billId, { summary: null, amendmentAgeHours: 1 })
    await runAlerts(page.request)
    expect(await lastEmail(page.request, user.email)).toBeNull()

    // After 12 hours, the alert goes out without the summary.
    const older = await addBillText(page.request, billId, { summary: null, amendmentAgeHours: 13 })
    await runAlerts(page.request)
    const email = await lastEmail(page.request, user.email)
    expect(email?.html).toContain(`New amendment #${older.amendmentNumber}`)
    expect(email?.html).not.toContain(`New amendment #${amendmentNumber}`)
  })
})
