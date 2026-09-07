import { test, expect, signUpFreshWorkspace, trackOneLcAndOneIntroducedBill } from './fixtures'

test.describe('LC Drafts / Introduced dashboard filters', () => {
  test('each filter changes the page title/subhead and shows only the matching bills', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { lc, introduced } = await trackOneLcAndOneIntroducedBill(page)
    // Scope nav clicks to the primary nav — several of these labels also
    // appear as substrings inside the dashboard's own stat cards
    // ("LC DRAFTS FILED", "HEARINGS, NEXT 30 DAYS"), which a bare text=
    // locator would also match.
    const nav = page.locator('nav[aria-label="Primary"]')

    await page.goto('/')
    await expect(page.locator('h1', { hasText: 'Dashboard' })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: lc.identifier })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: introduced.identifier })).toBeVisible()

    await nav.locator('button', { hasText: 'LC drafts' }).click()
    await expect(page.locator('h1', { hasText: 'LC Drafts' })).toBeVisible()
    await expect(page.locator('text=/\\d+ LC drafts? your team is tracking/')).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: lc.identifier })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: introduced.identifier })).not.toBeVisible()
    await expect(nav.locator('button', { hasText: 'LC drafts' })).toHaveAttribute('aria-current', 'page')

    await nav.locator('button', { hasText: 'Introduced (HB / SB)' }).click()
    await expect(page.locator('h1', { hasText: 'Introduced Bills' })).toBeVisible()
    await expect(page.locator('text=/\\d+ introduced bills? \\(HB\\/SB\\) your team is tracking/')).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: introduced.identifier })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: lc.identifier })).not.toBeVisible()

    await nav.locator('button', { hasText: 'All bills' }).click()
    await expect(page.locator('h1', { hasText: 'Dashboard' })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: lc.identifier })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: introduced.identifier })).toBeVisible()
  })
})

test.describe('Hearings page', () => {
  test('the nav item opens a real hearings list, searchable, linking to the committee', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')

    await page.locator('nav[aria-label="Primary"] button', { hasText: 'Hearings' }).click()
    await page.waitForURL('/hearings')
    await expect(page.locator('h1', { hasText: 'Hearings' })).toBeVisible()

    const firstRow = page.locator('a[class*="row"]').first()
    await expect(firstRow).toBeVisible()
    const committeeName = (await firstRow.locator('span[class*="rowCommittee"]').textContent())?.trim() ?? ''
    expect(committeeName).toBeTruthy()

    await page.fill('input[placeholder="Search by committee"]', 'zzzznomatch')
    await expect(page.locator('a[class*="row"]')).toHaveCount(0)
    await page.fill('input[placeholder="Search by committee"]', committeeName)
    await expect(page.locator('a[class*="row"]', { hasText: committeeName }).first()).toBeVisible()

    await page.locator('a[class*="row"]', { hasText: committeeName }).first().click()
    await page.waitForURL(/\/committees\/.+/)
    await expect(page.locator('h1', { hasText: committeeName })).toBeVisible()
  })

  test('following a committee highlights its hearing rows', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/hearings')
    await page.waitForSelector('a[class*="row"]')

    const firstRow = page.locator('a[class*="row"]').first()
    const committeeName = (await firstRow.locator('span[class*="rowCommittee"]').textContent())?.trim() ?? ''
    await expect(page.locator('[class*="followingBadge"]')).toHaveCount(0)

    await firstRow.click()
    await page.waitForURL(/\/committees\/.+/)
    await page.click('button:has-text("+ Follow")')
    await page.waitForSelector('button:has-text("Following")')

    await page.goto('/hearings')
    await page.waitForSelector('a[class*="row"]')
    const followedRows = page.locator('a[class*="row"]', { hasText: committeeName })
    const count = await followedRows.count()
    for (let i = 0; i < count; i++) {
      await expect(followedRows.nth(i).locator('[class*="followingBadge"]')).toBeVisible()
    }
    await expect(page.locator('[class*="followingBadge"]')).toHaveCount(count)
  })
})
