import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'

test.describe('dashboard bill table and drawer', () => {
  test('clicking a tracked bill opens the quick-view drawer, and "View full details" navigates to the full page', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackFirstAvailableBill(page)

    await page.goto('/')
    await page.locator('[role="row"]', { hasText: identifier }).click()
    const drawer = page.locator(`[aria-label="${identifier} details"]`)
    await expect(drawer).toBeVisible()

    // Every scraped bill has an AI summary generated (see server/src/generateSummaries.ts).
    await expect(drawer.locator('text=AI-generated summary')).toBeVisible()
    await expect(drawer.locator('[class*="aiSummaryText"]')).not.toBeEmpty()

    // Links straight to the bill on bills.legmt.gov itself, not just our
    // own full-details page — this is the one URL scheme confirmed to
    // resolve for a bill at any stage (verified against both an enacted
    // law and one that died in committee).
    const drawerOfficialLink = drawer.locator('a', { hasText: 'View on official site' })
    await expect(drawerOfficialLink).toHaveAttribute('href', /^https:\/\/bills\.legmt\.gov\/#\/laws\/bill\/\d+\/[A-Za-z0-9]+\?open_tab=bill$/)

    await page.click('text=View full details')
    await page.waitForURL(/\/bills\/.+/)
    await expect(page.locator('[aria-label*="details"]')).not.toBeVisible()

    const pageOfficialLink = page.locator('a', { hasText: 'View on official site' })
    await expect(pageOfficialLink).toHaveAttribute('href', /^https:\/\/bills\.legmt\.gov\/#\/laws\/bill\/\d+\/[A-Za-z0-9]+\?open_tab=bill$/)
  })
})

test.describe('team avatars', () => {
  test('clicking your own avatar in the TopBar filters the dashboard to your bills', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)
    await page.goto('/')

    const avatarButton = page.locator('[aria-label^="Filter bills assigned to"]').first()
    await expect(avatarButton).toBeVisible()
    await avatarButton.click()
    await expect(page.locator('[class*="chipActive"]', { hasText: 'Assignee' })).toBeVisible()
  })
})

test.describe('momentum model', () => {
  test('hiding and re-showing the momentum model persists across a reload', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const heading = page.locator('span.eyebrow', { hasText: 'Momentum model' })
    const showToggle = page.locator('button:has-text("Show momentum model")')

    await page.goto('/')
    await expect(heading).toBeVisible()

    await page.click('button:has-text("Hide")')
    await expect(heading).not.toBeVisible()
    await expect(showToggle).toBeVisible()

    await page.reload()
    await expect(showToggle).toBeVisible()

    await showToggle.click()
    await expect(heading).toBeVisible()
  })
})

test.describe('hearing audio', () => {
  test('clipping the active transcript segment to notes creates a note', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')

    const clipButton = page.locator('button', { hasText: 'Clip → notes' })
    if ((await clipButton.count()) === 0) {
      test.skip(true, 'no recorded hearing available to clip in this environment')
    }
    await clipButton.click()
    await expect(page.locator('text=Clipped').first()).toBeVisible()

    await page.goto('/notes')
    await expect(page.locator('text=From:').first()).toBeVisible()
  })
})
