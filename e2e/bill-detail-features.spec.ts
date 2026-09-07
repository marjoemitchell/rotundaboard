import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'

test.describe('tags', () => {
  test('adding and removing a tag on a bill works', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)

    await page.fill('input[placeholder="Add a tag…"]', 'Coalition priority')
    await page.click('button:has-text("Add")')
    await expect(page.locator('text=Coalition priority')).toBeVisible()

    await page.click('button[aria-label="Remove tag Coalition priority"]')
    await expect(page.locator('text=Coalition priority')).not.toBeVisible()
  })
})

test.describe('bill notes', () => {
  test('a note added from the bill page shows up on the global Notes page and can be deleted there', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackFirstAvailableBill(page)

    const noteBody = `E2E note ${Date.now()}`
    await page.fill('textarea[placeholder="Add a note about this bill…"]', noteBody)
    await page.locator('textarea[placeholder="Add a note about this bill…"]').locator('..').locator('button:has-text("Add")').click()
    await expect(page.locator(`text=${noteBody}`)).toBeVisible()

    await page.goto('/notes')
    await expect(page.locator(`text=${noteBody}`)).toBeVisible()
    await expect(page.locator(`text=${identifier}`)).toBeVisible()

    await page.locator('div[class^="_note_"]', { hasText: noteBody }).locator('button[aria-label="Delete note"]').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator(`text=${noteBody}`)).not.toBeVisible()
  })
})

test.describe('testimony from the bill page', () => {
  test('drafting testimony with text, changing its status, and deleting it works', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)

    await page.click('button:has-text("+ Draft")')
    const testimonyBody = `E2E testimony ${Date.now()}`
    await page.fill('textarea[placeholder*="Draft the testimony"]', testimonyBody)
    await page.click('button:has-text("Save draft")')
    await expect(page.locator(`text=${testimonyBody}`)).toBeVisible()

    await page.goto('/testimony')
    await expect(page.locator(`text=${testimonyBody}`).first()).toBeVisible()
    await page.locator('select[class^="_statusSelect_"]').first().selectOption('submitted')
    await expect(page.locator('span.eyebrow', { hasText: 'Submitted' })).toBeVisible()

    await page.locator('button[aria-label="Delete testimony"]').first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator(`text=${testimonyBody}`)).not.toBeVisible()
  })

  test('attaching a file to testimony and removing it works', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)

    await page.click('button:has-text("+ Draft")')
    await page.setInputFiles('input[type="file"]', {
      name: 'testimony.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is a pre-written testimony statement.'),
    })
    await page.click('button:has-text("Save draft")')
    await expect(page.locator('text=testimony.txt')).toBeVisible()

    const download = page.waitForEvent('download').catch(() => null)
    await page.click('text=📎 testimony.txt')
    await download

    await page.click('button:has-text("Remove")')
    await expect(page.locator('text=testimony.txt')).not.toBeVisible()
  })
})
