import { test, expect, signUpFreshWorkspace, createHearingFixture, uniqueSuffix } from './fixtures'
import type { Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// The bill drawer is also a dialog, so the palette is found by its own label.
const palette = (page: Page) => page.locator('[aria-label="Command palette"]')

async function searchFor(page: Page, query: string) {
  await page.getByRole('button', { name: /Search bills, legislators, committees, and hearings/ }).click()
  await palette(page).getByRole('textbox', { name: 'Search' }).fill(query)
}

test.describe('command palette search', () => {
  test('the search finds a bill that the team does not track, and opens its page', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const title = `E2E search draft ${uniqueSuffix()}`
    const res = await page.request.post(`${API_BASE}/api/__test__/open-drafts`, { data: { count: 1, titlePrefix: title } })
    const [bill] = (await res.json()).bills as { billId: string; identifier: string; title: string }[]

    await page.goto('/')
    await searchFor(page, title)
    await expect(palette(page).getByText('Bills', { exact: true })).toBeVisible()
    await palette(page).getByRole('button', { name: new RegExp(bill.title) }).click()
    await expect(page).toHaveURL(new RegExp(`/bills/${bill.billId}$`))
    await expect(page.getByRole('heading', { name: bill.title })).toBeVisible()
  })

  test('the search finds a legislator by name and opens the legislator page', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const map = await (await page.request.get(`${API_BASE}/api/legislators/map`)).json()
    const member = (map.members as { id: string; name: string }[])[0]

    await page.goto('/')
    await searchFor(page, member.name)
    const group = palette(page).getByText('Legislators', { exact: true })
    await expect(group).toBeVisible()
    await palette(page).getByRole('button', { name: new RegExp(member.name) }).first().click()
    await expect(page).toHaveURL(/\/legislators\/\d+$/)
    await expect(page.getByRole('heading', { name: member.name, level: 1 })).toBeVisible()
  })

  test('the search finds an interim committee and a hearing recording', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const recording = await createHearingFixture(page.request, { segments: [{ start: 0, end: 5, text: 'Good morning.' }] })

    await page.goto('/')
    await searchFor(page, recording.committee)
    await expect(palette(page).getByText('Interim committees', { exact: true })).toBeVisible()
    await expect(palette(page).getByText('Hearing recordings', { exact: true })).toBeVisible()

    // The fixture is the newest recording, so it is the first one in its group.
    await palette(page).locator('div:has(> [class*="groupLabel"]:text-is("Hearing recordings")) button').click()
    await expect(page).toHaveURL(new RegExp(`/hearings/recordings/${recording.id}$`))

    await searchFor(page, recording.committee)
    await palette(page).locator('div:has(> [class*="groupLabel"]:text-is("Interim committees")) button').click()
    await expect(page).toHaveURL(/\/committees\/\d+$/)
    await expect(page.getByRole('heading', { name: recording.committee, level: 1 })).toBeVisible()
  })

  test('a search with no results says so', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')
    await searchFor(page, `zzqx${uniqueSuffix()}`)
    await expect(palette(page).getByText('No matches.')).toBeVisible()
  })
})
