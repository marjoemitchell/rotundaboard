import { test, expect, signUpFreshWorkspace } from './fixtures'

test.describe('mobile TopBar', () => {
  test('the header stays a single row and settings/logout stay reachable at phone widths', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await signUpFreshWorkspace(page)

    const header = page.locator('header')
    await expect(header).toHaveCSS('height', '52px')

    // The search button's placeholder text is allowed to truncate (that's
    // the fix — it used to wrap to multiple lines and blow up the header's
    // height, overlapping the page content below), but the header element
    // itself must never need horizontal scrolling to contain its children.
    const overflowsViewport = await header.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflowsViewport).toBe(false)

    // Settings/logout live in the LeftNav's bottom account block now, not
    // the header — reachable via the hamburger menu at phone widths.
    await page.locator('button', { hasText: 'Menu' }).click()
    const nav = page.locator('nav[aria-label="Primary"]')
    await expect(nav.locator('a', { hasText: 'Settings' })).toBeVisible()
    await expect(nav.locator('button', { hasText: 'Log out' })).toBeVisible()
  })

  test('the hamburger menu button uses a dark, readable color on the light page background', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await signUpFreshWorkspace(page)

    // Was previously var(--ink-body), a light color meant for dark surfaces
    // (the navy TopBar) — this button sits on the light page background
    // instead, so it read as near-invisible light-gray-on-light-gray.
    const color = await page.locator('button', { hasText: 'Menu' }).evaluate((el) => getComputedStyle(el).color)
    expect(color).toBe('rgb(43, 63, 92)')
  })
})
