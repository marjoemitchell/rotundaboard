import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill, trackWorkingSessionBill, uniqueSuffix } from './fixtures'
import type { Page } from '@playwright/test'

// The subject dropdown on the bill page shows the default subjects and the
// custom subjects of the workspace. It can also make a new custom subject.

function subjectsSection(page: Page) {
  return page.getByRole('region', { name: 'Subjects' })
}

function subjectBox(page: Page) {
  return subjectsSection(page).getByRole('combobox', { name: 'Add a subject' })
}

function subjectList(page: Page) {
  return subjectsSection(page).getByRole('listbox', { name: 'Subjects' })
}

test.describe('bill subjects', () => {
  test('the dropdown applies a default subject to the bill, and the subject can be removed', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackWorkingSessionBill(page)

    await subjectBox(page).click()
    await expect(subjectList(page).getByText('Default subjects')).toBeVisible()
    const option = subjectList(page).getByRole('option').first()
    const subject = ((await option.textContent()) ?? '').trim()
    expect(subject).not.toBe('')
    await option.click()

    const remove = subjectsSection(page).getByRole('button', { name: `Remove subject ${subject}`, exact: true })
    await expect(remove).toBeVisible()

    // The subject stays on the bill after a reload, and the dropdown does not offer it again.
    await page.reload()
    await expect(remove).toBeVisible()
    await subjectBox(page).fill(subject)
    await expect(subjectList(page).getByRole('option', { name: subject, exact: true })).toHaveCount(0)

    await remove.click()
    await expect(remove).toHaveCount(0)
    await page.reload()
    await expect(subjectsSection(page).getByRole('button', { name: `Remove subject ${subject}`, exact: true })).toHaveCount(0)
  })

  test('the dropdown makes a new custom subject, and other bills can use that custom subject', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackWorkingSessionBill(page)
    const custom = `E2E Custom ${uniqueSuffix()}`

    await subjectBox(page).fill(custom)
    await expect(subjectList(page).getByRole('option', { name: `Create custom subject “${custom}”` })).toBeVisible()
    await subjectBox(page).press('Enter')
    await expect(subjectsSection(page).getByRole('button', { name: `Remove subject ${custom}`, exact: true })).toBeVisible()

    // On another bill, the dropdown shows the custom subject with the default subjects.
    await trackFirstAvailableBill(page, { index: 1 })
    await subjectBox(page).click()
    await expect(subjectList(page).getByText('Custom subjects')).toBeVisible()
    await expect(subjectList(page).getByText('Default subjects')).toBeVisible()
    const customOption = subjectList(page).getByRole('option', { name: new RegExp(custom) })
    await expect(customOption).toContainText('Custom')
    // The name of an existing subject does not give a "Create" option.
    await subjectBox(page).fill(custom)
    await expect(subjectList(page).getByRole('option', { name: /Create custom subject/ })).toHaveCount(0)
    await customOption.click()
    await expect(subjectsSection(page).getByRole('button', { name: `Remove subject ${custom}`, exact: true })).toBeVisible()
  })

  test('a subject watch finds a bill through a default subject that the workspace applied', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackWorkingSessionBill(page)

    await subjectBox(page).click()
    const option = subjectList(page).getByRole('option').first()
    const subject = ((await option.textContent()) ?? '').trim()
    await option.click()
    await expect(subjectsSection(page).getByRole('button', { name: `Remove subject ${subject}`, exact: true })).toBeVisible()

    await page.goto('/watches')
    await page.click('button:has-text("+ New watch")')
    await page.fill('input[placeholder="e.g. Water rights"]', 'E2E Watch by applied subject')
    await page.fill('input[placeholder="Search subjects…"]', subject)
    await page.getByRole('checkbox', { name: subject, exact: true }).check()
    await page.click('button:has-text("Create watch")')

    const card = page.locator('[class*="watchCard"]', { hasText: 'E2E Watch by applied subject' })
    await card.locator('button[class*="matchCount"]').click()
    const row = card.locator('[class*="matchRow"]').filter({ has: page.getByRole('link', { name: identifier, exact: true }) })
    await expect(row).toBeVisible()
    await expect(row.locator('[class*="matchReason"]')).toContainText(subject)
  })
})
