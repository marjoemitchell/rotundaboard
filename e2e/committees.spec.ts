import { test, expect, signUpFreshWorkspace } from './fixtures'

test.describe('interim committees', () => {
  test('following a committee from the list page shows it followed, and searching filters the list', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/committees')
    await expect(page.locator('div[class^="_row_"]').first()).toBeVisible()

    const firstRow = page.locator('div[class^="_row_"]').first()
    const name = (await firstRow.locator('[class*="rowName"]').textContent())?.trim() ?? ''
    expect(name).toBeTruthy()
    await firstRow.locator('button', { hasText: '+ Follow' }).click()
    await expect(firstRow.locator('button', { hasText: 'Following' })).toBeVisible()

    await page.fill('input[placeholder="Search committees"]', 'zzzznomatch')
    await expect(page.locator('div[class^="_row_"]')).toHaveCount(0)
    await page.fill('input[placeholder="Search committees"]', '')
    await expect(page.locator('div[class^="_row_"]', { hasText: name })).toBeVisible()
  })

  test('a followed committee appears on the dashboard rail, and unfollowing from the detail page removes it', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/committees')
    const firstRow = page.locator('div[class^="_row_"]').first()
    const name = (await firstRow.locator('[class*="rowName"]').textContent())?.trim() ?? ''
    await firstRow.locator('a[class*="rowMain"]').click()
    await page.waitForURL(/\/committees\/.+/)

    // committees.legmt.gov is a hash-routed SPA — a plain-path link 404s at
    // the server before React Router ever sees it, so the href must keep
    // the "#" (see CommitteeDetailPage.tsx).
    const officialLink = page.locator('a', { hasText: 'View on official site' })
    await expect(officialLink).toBeVisible()
    await expect(officialLink).toHaveAttribute('href', /^https:\/\/committees\.legmt\.gov\/#\/nonStandingCommittees\/\d+$/)
    await page.locator('button', { hasText: '+ Follow' }).click()
    await expect(page.locator('button', { hasText: 'Following' })).toBeVisible()

    await page.goto('/')
    await expect(page.locator('[class*="itemName"]', { hasText: name })).toBeVisible()

    await page.goBack()
    await page.waitForURL(/\/committees\/.+/)
    await page.locator('button', { hasText: 'Following' }).click()
    await expect(page.locator('button', { hasText: '+ Follow' })).toBeVisible()
  })

  test('a committee with published meeting materials shows them, with working document links', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/committees')
    await expect(page.locator('div[class^="_row_"]').first()).toBeVisible()
    const rowLinks = page.locator('a[class*="rowMain"]')
    const count = await rowLinks.count()
    expect(count).toBeGreaterThan(0)

    // Not every committee has published materials — check rows until one
    // does, rather than assuming a specific committee (data comes from a
    // live scrape, not a fixture).
    let found = false
    for (let i = 0; i < Math.min(count, 15); i++) {
      await page.goto('/committees')
      await rowLinks.nth(i).click()
      await page.waitForURL(/\/committees\/.+/)
      if (await page.locator('.eyebrow', { hasText: 'Meeting materials' }).isVisible()) {
        found = true
        break
      }
    }
    expect(found).toBe(true)

    const materialsLink = page.locator('[class*="materials"] a').first()
    await expect(materialsLink).toBeVisible()
    await expect(materialsLink).toHaveAttribute('href', /^https:\/\//)
  })
})
