import { test, expect, signUpFreshWorkspace } from './fixtures'

const API_BASE = 'http://localhost:4000'

type DraftFixture = {
  bills: { billId: string; identifier: string; title: string }[]
  sessionId: string
  requester: string
  byRequestOf: { legislatorId: string; name: string } | null
}

// An LC draft has a requester (a legislator, a committee, or an agency), not
// a sponsor. The fixture draft is requested by an E2E agency, by request of a
// legislator.
async function createDraft(page: import('@playwright/test').Page): Promise<DraftFixture> {
  const res = await page.request.post(`${API_BASE}/api/__test__/open-drafts`, {
    data: { count: 1, ageMinutes: 1440, byRequestOf: true },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as DraftFixture
}

test.describe('LC draft requester', () => {
  test('the bill page of a draft shows the requester and "by request of", not a sponsor', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const draft = await createDraft(page)
    const [bill] = draft.bills

    await page.goto(`/bills/${bill.billId}`)
    await expect(page.getByRole('heading', { name: bill.title })).toBeVisible()
    await expect(page.locator('.eyebrow', { hasText: /^Requester$/ })).toBeVisible()
    await expect(page.locator('.eyebrow', { hasText: /^Sponsor$/ })).toHaveCount(0)
    await expect(page.getByText('Not yet assigned')).toHaveCount(0)
    await expect(page.getByText(draft.requester, { exact: true })).toBeVisible()

    // The "by request of" legislator links to the legislator page.
    const legislator = page.getByRole('link', { name: draft.byRequestOf!.name, exact: true })
    await expect(legislator).toBeVisible()
    await legislator.click()
    await expect(page).toHaveURL(new RegExp(`/legislators/${draft.byRequestOf!.legislatorId}$`))
  })

  test('the dashboard table, the drawer, and the tracking board show the requester of a tracked draft', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const draft = await createDraft(page)
    const [bill] = draft.bills
    expect((await page.request.post(`${API_BASE}/api/bills/${bill.billId}/track`)).ok()).toBeTruthy()

    await page.goto('/')
    const row = page.locator('[role="row"]', { hasText: bill.identifier })
    await expect(row.locator('[class*="sponsorName"]')).toHaveText(`Requested by ${draft.requester}`)

    await row.click()
    const drawer = page.locator(`[aria-label="${bill.identifier} details"]`)
    await expect(drawer.locator('[class*="sectionEyebrow"]', { hasText: /^Requester$/ })).toBeVisible()
    await expect(drawer.locator('[class*="sectionEyebrow"]', { hasText: /^Sponsor$/ })).toHaveCount(0)
    await expect(drawer).toContainText(draft.requester)

    await page.goto('/tracking-board')
    await expect(page.locator('[class*="cardSponsor"]', { hasText: `Requested by ${draft.requester}` })).toBeVisible()
  })

  test('the LC drafts list shows a Requester column, and the search finds a draft by its requester', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const draft = await createDraft(page)
    const [bill] = draft.bills

    await page.goto(`/bills?session=${draft.sessionId}&type=lc`)
    await expect(page.getByRole('columnheader', { name: 'Requester' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Sponsor' })).toHaveCount(0)
    await page.getByPlaceholder('Search by bill number, title, sponsor, or requester').fill(draft.requester)
    const rows = page.getByRole('row').filter({ hasText: bill.identifier })
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(draft.requester)

    // In the list of all bills, the column is "Sponsor", and a draft row names its requester.
    await page.goto(`/bills?session=${draft.sessionId}&type=all&q=${encodeURIComponent(draft.requester)}`)
    await expect(page.getByRole('columnheader', { name: 'Sponsor' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: bill.identifier })).toContainText(`Requested by ${draft.requester}`)
  })
})
