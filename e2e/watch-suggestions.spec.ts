import { test, expect, signUpFreshWorkspace, trackWorkingSessionBill, uniqueSuffix } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

type FixtureBill = { billId: string; identifier: string }

// A bill of the working session with an AI summary and no subject codes.
async function summarizedBill(request: APIRequestContext, title: string, summary: string): Promise<FixtureBill> {
  const res = await request.post(`${API_BASE}/api/__test__/summarized-bill`, { data: { title, summary } })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

// One word that no real bill summary has. The words of the custom subject must all be in a summary to match it.
function uniqueWord(): string {
  return `zebra${uniqueSuffix().replace(/\D/g, '')}`
}

// Makes a custom subject on a tracked bill of the working session, then a watch on that subject.
async function watchCustomSubject(page: Page, subjectName: string, watchName: string) {
  await trackWorkingSessionBill(page)
  await page.getByRole('combobox', { name: 'Add a subject' }).fill(subjectName)
  await page.getByRole('option', { name: `Create custom subject “${subjectName}”` }).click()
  await expect(page.getByRole('button', { name: `Remove subject ${subjectName}`, exact: true })).toBeVisible()

  await page.goto('/watches')
  await page.click('button:has-text("+ New watch")')
  await page.fill('input[placeholder="e.g. Water rights"]', watchName)
  await page.fill('input[placeholder="Search subjects…"]', subjectName)
  await page.getByRole('group', { name: 'Subjects' }).locator('label', { hasText: subjectName }).locator('input').check()
  await page.click('button:has-text("Create watch")')
  await expect(watchCard(page, watchName)).toBeVisible()
}

const watchCard = (page: Page, name: string) => page.locator('[class*="watchName"]', { hasText: name })
const suggestions = (page: Page) => page.getByRole('region', { name: 'Suggested from AI summaries' })

test.describe('suggestions from AI summaries', () => {
  test('a workspace with no subject watches gets no suggestions', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const word = uniqueWord()
    await summarizedBill(page.request, `E2E unwatched ${word}`, `E2E fixture about ${word}.`)

    await page.goto('/watches')
    await expect(page.getByText('No subject watches yet.', { exact: false })).toBeVisible()
    await expect(suggestions(page)).toHaveCount(0)

    const data = await page.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/api/subject-watches/suggestions`, { credentials: 'include' })
      return res.json()
    }, API_BASE)
    expect(data).toEqual({ hasWatches: false, bills: [] })
  })

  test('a bill whose AI summary mentions a watched subject is suggested, and tracking it removes it', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const word = uniqueWord()
    const subjectName = `E2E ${word}`
    const watchName = `E2E Summary watch ${word}`
    const match = await summarizedBill(
      page.request,
      `E2E suggested ${word}`,
      `This E2E fixture changes the ${word} rules for e2e programs.`,
    )
    const noMatch = await summarizedBill(page.request, `E2E other ${word}`, 'This E2E fixture has no watched words.')
    const tracked = await summarizedBill(page.request, `E2E tracked ${word}`, `This E2E fixture is about e2e ${word}.`)
    const res = await page.request.post(`${API_BASE}/api/bills/${tracked.billId}/track`)
    expect(res.ok()).toBeTruthy()

    await watchCustomSubject(page, subjectName, watchName)

    // The bill has no subjects, so the watch itself does not show it. The suggestions show it.
    const section = suggestions(page)
    await expect(section).toBeVisible()
    const row = section.locator('[class*="matchRow"]', { hasText: match.identifier })
    await expect(row).toBeVisible()
    await expect(row).toContainText(`E2E suggested ${word}`)
    await expect(row).toContainText(`This E2E fixture changes the ${word} rules`)
    await expect(row).toContainText(`Watch: ${watchName}, via ${subjectName}`)
    // A summary without the subject words is not suggested.
    await expect(section.getByText(noMatch.identifier)).toHaveCount(0)
    // A bill that the workspace tracks is not suggested.
    await expect(section.getByText(tracked.identifier)).toHaveCount(0)

    await section.getByRole('button', { name: `Track ${match.identifier}` }).click()
    await expect(section.getByText(match.identifier)).toHaveCount(0)
    await expect(section.getByText('No AI summaries match your watches yet.')).toBeVisible()

    // The bill stays tracked after a reload, and the section does not suggest it again.
    await page.reload()
    await expect(suggestions(page)).toBeVisible()
    await expect(suggestions(page).getByText(match.identifier)).toHaveCount(0)
    await page.goto(`/bills/${match.billId}`)
    await expect(page.getByRole('button', { name: 'Stop tracking' })).toBeVisible()
  })

  test('deleting the last watch removes the suggestions', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const word = uniqueWord()
    const subjectName = `E2E ${word}`
    const watchName = `E2E Delete watch ${word}`
    const match = await summarizedBill(page.request, `E2E suggested ${word}`, `An E2E fixture about ${word}.`)

    await watchCustomSubject(page, subjectName, watchName)
    await expect(suggestions(page).getByText(match.identifier)).toBeVisible()

    await page.click(`button[aria-label="Delete ${watchName}"]`)
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(watchCard(page, watchName)).toHaveCount(0)
    await expect(suggestions(page)).toHaveCount(0)
  })
})
