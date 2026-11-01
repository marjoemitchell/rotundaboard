import type { Page } from '@playwright/test'
import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'

// Returns the column of the tracking board that has the given label.
function boardColumn(page: Page, label: string) {
  return page
    .locator('div[class^="_column_"]')
    .filter({ has: page.locator('[class^="_columnLabel_"]', { hasText: new RegExp(`^${label}$`) }) })
}

// Returns the bill ids of the cards in a column, from the top to the bottom.
async function cardOrder(page: Page, label: string): Promise<string[]> {
  return boardColumn(page, label)
    .locator('div[class^="_card_"]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-bill-id') ?? ''))
}

test.describe('bill priority', () => {
  test('the tracking board puts the highest priority bills at the top of a column', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const first = await trackFirstAvailableBill(page, { index: 0 })
    const second = await trackFirstAvailableBill(page, { index: 1 })
    const third = await trackFirstAvailableBill(page, { index: 2 })

    await page.goto('/tracking-board')
    const column = boardColumn(page, 'No position')
    await expect(column.locator('div[class^="_card_"]')).toHaveCount(3)

    // Set the priorities on the board cards.
    await page.locator(`select[aria-label="Priority for ${third.identifier}"]`).selectOption('high')
    await expect(column.locator(`div[data-bill-id="${third.billId}"]`)).toContainText('High')
    await page.locator(`select[aria-label="Priority for ${first.identifier}"]`).selectOption('low')
    await expect(column.locator(`div[data-bill-id="${first.billId}"]`)).toContainText('Low')

    // High comes first, then low. A bill with no priority goes to the bottom.
    await expect.poll(() => cardOrder(page, 'No position')).toEqual([third.billId, first.billId, second.billId])

    // The order stays the same after a reload.
    await page.reload()
    await expect.poll(() => cardOrder(page, 'No position')).toEqual([third.billId, first.billId, second.billId])
    await expect(page.locator(`select[aria-label="Priority for ${third.identifier}"]`)).toHaveValue('high')

    // Remove the priority. The bill goes back below the bill with a low priority.
    await page.locator(`select[aria-label="Priority for ${third.identifier}"]`).selectOption('')
    await expect.poll(() => cardOrder(page, 'No position')).toEqual([first.billId, second.billId, third.billId])
  })

  test('the priority set on the bill detail page shows on the tracking board', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackFirstAvailableBill(page)

    const prioritySelect = page.locator('label', { hasText: 'Priority' }).locator('select')
    await prioritySelect.selectOption('medium')
    await page.waitForLoadState('networkidle')
    await page.reload()
    await expect(page.locator('label', { hasText: 'Priority' }).locator('select')).toHaveValue('medium')

    await page.goto('/tracking-board')
    const card = boardColumn(page, 'No position').locator(`div[data-bill-id="${billId}"]`)
    await expect(card).toContainText(identifier)
    await expect(card.locator('[class*="priorityBadge"]')).toHaveText('Medium')
  })

  test('the priority set in the bill drawer shows on the tracking board', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackFirstAvailableBill(page)

    await page.goto('/tracking-board')
    await page.locator(`div[data-bill-id="${billId}"] button`).first().click()
    const drawerSelect = page.locator('select[aria-label="Priority"]')
    await expect(drawerSelect).toBeVisible()
    await drawerSelect.selectOption('high')

    const card = page.locator(`div[data-bill-id="${billId}"]`)
    await expect(card.locator('[class*="priorityBadge"]')).toHaveText('High')
    await expect(page.locator(`select[aria-label="Priority for ${identifier}"]`)).toHaveValue('high')
  })
})
