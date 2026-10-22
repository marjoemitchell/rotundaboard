import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill, showClosedBills } from './fixtures'

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

  test('Settings in the phone menu opens the settings page and closes the menu', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await signUpFreshWorkspace(page)
    const nav = page.locator('nav[aria-label="Primary"]')

    await page.locator('button', { hasText: 'Menu' }).click()
    const settings = nav.locator('a', { hasText: 'Settings' })
    // The link is on the screen, not under the bottom edge.
    await expect(settings).toBeInViewport({ ratio: 1 })
    await settings.click()

    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.locator('h1', { hasText: 'Settings' })).toBeInViewport()
    await expect(nav).not.toBeInViewport()
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

  test('the outcome/momentum indicator sits beside the bill number at phone widths instead of overflowing the page', async ({
    page,
  }) => {
    // Regression test: at <=760px the bill table used to keep a separate
    // fixed 76px-wide grid column for the outcome badge/momentum bar —
    // plenty for a momentum score, but text like "Became law" is wider than
    // that column and spilled past the edge of the page. It now renders
    // inline next to the bill number at the top of the card instead, where
    // a full row of width is available.
    await page.setViewportSize({ width: 414, height: 846 })
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)

    await page.goto('/')
    await showClosedBills(page)
    await page.waitForSelector('[class*="inlineTopRow"]')

    const overflowsViewport = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflowsViewport).toBe(false)

    const topRow = page.locator('[class*="inlineTopRow"]').first()
    await expect(topRow.locator('[class*="billNumber"]')).toBeVisible()
    await expect(topRow.locator('[class*="inlineOutcome"]')).toBeVisible()
  })
})

test.describe('mobile layout', () => {
  // Pages that must fit a phone screen with no sideways scroll.
  const PAGES = ['/', '/bills', '/hearings', '/legislators', '/watches', '/committees', '/notes', '/testimony', '/settings', '/sessions']

  test('every main page fits a phone screen, with no sideways scroll', async ({ page }) => {
    test.slow()
    await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page)
    await page.setViewportSize({ width: 375, height: 700 })
    for (const path of [...PAGES, `/bills/${billId}`]) {
      await page.goto(path)
      await expect(page.locator('h1').first()).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(0)
    }
  })

  test('the bill page controls wrap, so "Stop tracking" stays on the screen', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page)
    await page.setViewportSize({ width: 375, height: 700 })
    await page.goto(`/bills/${billId}`)
    await expect(page.getByRole('button', { name: 'Stop tracking' })).toBeInViewport({ ratio: 1 })
  })

  test('the All bills and Legislators lists show cards, with no column header', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.setViewportSize({ width: 375, height: 700 })

    await page.goto('/bills')
    const billRow = page.locator('a[role="row"]').first()
    await expect(billRow).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Sponsor' })).toBeHidden()
    // The status is in the card, on the screen, not in a column off to the side.
    await expect(billRow.locator('[class*="statusCell"]')).toBeInViewport({ ratio: 1 })

    await page.goto('/legislators')
    const legislatorRow = page.locator('a[role="row"]').first()
    await expect(legislatorRow).toBeVisible()
    await expect(legislatorRow.locator('[role="cell"]').nth(3)).toBeInViewport({ ratio: 1 })
  })
})
