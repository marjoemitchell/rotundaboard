import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill, findSessionIdWithBills } from './fixtures'

test.describe('sessions browsing', () => {
  test('browsing from Sessions to a session\'s bills to a bill detail page works', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const sessionId = await findSessionIdWithBills(page)
    await page.goto('/sessions')
    const sessionCard = page.locator(`a[href="/sessions/${sessionId}"]`)
    await expect(sessionCard).toBeVisible()
    await sessionCard.click()
    await page.waitForURL(`/sessions/${sessionId}`)
    await expect(page.locator('a[role="row"]').first()).toBeVisible()

    const firstRow = page.locator('a[role="row"]').first()
    const identifier = (await firstRow.locator('[class*="identifier"]').textContent())?.trim()
    await firstRow.click()
    await page.waitForURL(/\/bills\/.+/)
    expect(identifier).toBeTruthy()
    await expect(page.locator('[class*="identifier"]', { hasText: identifier! }).first()).toBeVisible()
  })

  test('searching session bills filters the list', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const sessionId = await findSessionIdWithBills(page)
    await page.goto(`/sessions/${sessionId}`)
    await expect(page.locator('a[role="row"]').first()).toBeVisible()

    const totalText = await page.locator('[class*="resultCount"]').textContent()
    await page.fill('input[placeholder*="Search by bill number"]', 'zzzzznomatch')
    await expect(page.locator('a[role="row"]')).toHaveCount(0)
    await expect(page.locator('text=0 of')).toBeVisible()
    await page.fill('input[placeholder*="Search by bill number"]', '')
    await expect(page.locator('[class*="resultCount"]')).toHaveText(totalText ?? '')
  })
})

test.describe('tracking a bill', () => {
  test('tracking a bill surfaces it on the dashboard and tracking board, untracking removes it', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackFirstAvailableBill(page)

    await page.goto('/')
    await expect(page.locator(`text=${identifier}`).first()).toBeVisible()

    await page.goto('/tracking-board')
    await expect(page.locator('text=No bills are being tracked yet')).not.toBeVisible()
    await expect(page.locator(`text=${identifier}`).first()).toBeVisible()

    await page.goto(`/bills/${billId}`)
    await page.click('button:has-text("Stop tracking")')
    await expect(page.locator('button:has-text("+ Track this bill")')).toBeVisible()
    await page.goto('/tracking-board')
    await expect(page.locator('text=No bills are being tracked yet')).toBeVisible()
  })

  test('changing position and assignee on the bill detail page reflects on the tracking board', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackFirstAvailableBill(page)

    // The position/assignee <select>s have no stable id, so target them by
    // their enclosing <label> text instead.
    await page.locator('label', { hasText: 'Position' }).locator('select').selectOption('support')
    await page.waitForTimeout(500)
    await page.locator('label', { hasText: 'Assignee' }).locator('select').selectOption({ index: 1 })
    await page.waitForTimeout(500)

    await page.goto('/tracking-board')
    // Column/card class names are all prefixed variants of each other
    // ("column", "columnHead", "columnBody"...), so a plain [class*=] scan
    // over-matches; anchor on the exact CSS-module prefix ("_column_",
    // trailing underscore) to get only the outer column/card wrapper.
    const supportColumn = page.locator('div[class^="_column_"]', { hasText: 'Support' }).first()
    await expect(supportColumn.locator('div[class^="_card_"]')).toHaveCount(1)
    await expect(supportColumn.locator('div[class^="_card_"]')).toContainText(identifier)
  })
})

test.describe('saved views', () => {
  test('saving the current filters as a view, applying it, and deleting it all work', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)
    await page.goto('/')

    await page.locator('select[aria-label="Add filter"]').selectOption('chamber')
    await expect(page.locator('[class*="chipActive"]')).toBeVisible()

    // Applying a saved view pops a toast that also says its name, so scope
    // to the nav button itself rather than a bare text= match.
    const savedViewButton = page.getByRole('button', { name: 'My saved view', exact: true })

    page.once('dialog', (d) => d.accept('My saved view'))
    await page.click('button:has-text("Save as view")')
    await expect(savedViewButton).toBeVisible()

    await page.locator('[aria-label="Remove Chamber filter"]').click()
    await expect(page.locator('[class*="chipActive"]')).toHaveCount(0)

    await savedViewButton.click()
    await expect(page.locator('[class*="chipActive"]')).toBeVisible()

    page.once('dialog', (d) => d.accept())
    await page.locator('[aria-label="Delete saved view My saved view"]').click()
    await expect(savedViewButton).not.toBeVisible()
  })
})
