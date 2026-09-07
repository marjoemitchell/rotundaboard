import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'

test.describe('digests', () => {
  test('generating a digest against workspace activity, then deleting it, works', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)

    await page.goto('/digests')
    await expect(page.locator('text=No digests yet')).toBeVisible()

    await page.click('button:has-text("+ Generate digest")')
    await expect(page.locator('text=No digests yet')).not.toBeVisible()
    await expect(page.locator('[class*="period"]').first()).toBeVisible()
    await expect(page.locator('[class*="summary"]').first()).toBeVisible()

    await page.click('button[aria-label="Delete digest"]')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator('text=No digests yet')).toBeVisible()
  })
})
