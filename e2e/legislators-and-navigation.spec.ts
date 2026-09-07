import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'

test.describe('legislators', () => {
  test('browsing the legislators list, searching, and viewing a detail page works', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/legislators')
    await expect(page.locator('a[role="row"]').first()).toBeVisible()

    const totalText = await page.locator('[class*="resultCount"]').textContent()
    const firstName = (await page.locator('[class*="name"]').first().textContent())?.trim() ?? ''
    expect(firstName).toBeTruthy()

    await page.fill('input[placeholder*="Search by name"]', 'zzzznomatch')
    await expect(page.locator('a[role="row"]')).toHaveCount(0)
    await page.fill('input[placeholder*="Search by name"]', '')
    await expect(page.locator('[class*="resultCount"]')).toHaveText(totalText ?? '')

    await page.locator('a[role="row"]').first().click()
    await page.waitForURL(/\/legislators\/.+/)
    await expect(page.locator('h1', { hasText: firstName })).toBeVisible()
  })
})

test.describe('command palette', () => {
  test('opening the palette, jumping to a bill, and navigating to a destination both work', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackFirstAvailableBill(page)

    // The bill-detail drawer is also role="dialog", so scope palette checks
    // to its own aria-label rather than the bare role.
    const palette = page.locator('[aria-label="Command palette"]')

    await page.goto('/')
    await page.click('button:has-text("Jump to a bill, hearing, or legislator")')
    await page.fill('input[placeholder="Jump to a bill, hearing, or legislator…"]', identifier)
    // A bare substring search for e.g. "SB 1" also matches "SB 10", "SB 11"...
    // so click the option whose identifier text is an exact match.
    await palette.getByText(identifier, { exact: true }).click()
    await expect(palette).not.toBeVisible()
    await expect(page.locator('[aria-label*="details"]')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.click('button:has-text("Jump to a bill, hearing, or legislator")')
    await page.fill('input[placeholder="Jump to a bill, hearing, or legislator…"]', 'Notes')
    await palette.getByText('Notes', { exact: true }).click()
    await page.waitForURL(/\/notes/)
  })

  test('Escape closes the command palette', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const palette = page.locator('[aria-label="Command palette"]')
    await page.click('button:has-text("Jump to a bill, hearing, or legislator")')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).not.toBeVisible()
  })
})
