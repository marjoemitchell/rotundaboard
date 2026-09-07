import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'

test.describe('subject watches', () => {
  test('creating a watch from an official subject code surfaces matching bills', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/watches')
    await page.click('button:has-text("+ New watch")')
    await page.fill('input[placeholder="e.g. Water rights"]', 'E2E Watch by subject')

    await page.fill('input[placeholder="Search subjects…"]', '')
    const firstOption = page.locator('[class*="optionRow"]').first()
    await expect(firstOption).toBeVisible()
    const subjectLabel = (await firstOption.textContent())?.trim() ?? ''
    await firstOption.locator('input[type="checkbox"]').check()

    await page.click('button:has-text("Create watch")')
    await expect(page.locator('text=E2E Watch by subject')).toBeVisible()
    if (subjectLabel) await expect(page.locator(`text=${subjectLabel}`).first()).toBeVisible()
  })

  test('tagging a bill and creating a watch from that tag surfaces the bill, and deleting the watch works', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)
    const tagName = `E2E Tag ${Date.now()}`
    await page.fill('input[placeholder="Add a tag…"]', tagName)
    await page.click('button:has-text("Add")')
    await expect(page.locator(`text=${tagName}`)).toBeVisible()

    await page.goto('/watches')
    await page.click('button:has-text("+ New watch")')
    await page.fill('input[placeholder="e.g. Water rights"]', 'E2E Watch by tag')
    await page.locator('label', { hasText: tagName }).locator('input[type="checkbox"]').check()
    await page.click('button:has-text("Create watch")')
    await expect(page.locator('text=E2E Watch by tag')).toBeVisible()

    await page.locator('button[class*="matchCount"]', { hasText: '1 matching' }).click()
    await expect(page.locator('[class*="matchRow"]')).toHaveCount(1)

    await page.click('button[aria-label="Delete E2E Watch by tag"]')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator('text=E2E Watch by tag')).not.toBeVisible()
  })
})
