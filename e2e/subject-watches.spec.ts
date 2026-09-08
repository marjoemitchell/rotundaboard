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

  test('results rank bills where the matched subject is central above ones where it is incidental, and show why each matched', async ({
    page,
  }) => {
    // Regression test: a watch used to match on ANY subject a bill carried
    // and rank results by bare bill number, with no way to tell a bill
    // that's centrally about the watched topic from one that only
    // incidentally touches it (e.g. a resolution about a national
    // anniversary that happens to also be tagged "Education - K-12" once
    // showed up ahead of bills that are actually about K-12 education).
    // Montana's data has no reliable per-bill "primary subject" signal (see
    // determineOutcome's neighbor comment in queries.ts), so results are now
    // ranked by how many subjects the bill carries overall — fewer means the
    // matched one is more likely central — and each result says which
    // subject(s) actually matched.
    await signUpFreshWorkspace(page)
    await page.goto('/watches')
    await page.click('button:has-text("+ New watch")')
    await page.fill('input[placeholder="e.g. Water rights"]', 'E2E K-12 Watch')
    await page.fill('input[placeholder="Search subjects…"]', 'K-12')
    const option = page.locator('[class*="optionRow"]', { hasText: 'K-12' }).first()
    await expect(option).toBeVisible()
    await option.locator('input[type="checkbox"]').check()
    await page.click('button:has-text("Create watch")')
    await expect(page.locator('text=E2E K-12 Watch')).toBeVisible()

    const watches = await page.evaluate(async () => {
      const res = await fetch('http://localhost:4000/api/subject-watches', { credentials: 'include' })
      return (await res.json()) as { id: string; name: string }[]
    })
    const watch = watches.find((w) => w.name === 'E2E K-12 Watch')
    expect(watch).toBeTruthy()

    const bills = await page.evaluate(async (watchId) => {
      const res = await fetch(`http://localhost:4000/api/subject-watches/${watchId}/bills`, { credentials: 'include' })
      return (await res.json()) as { matchedSubjects: string[]; subjectCount: number }[]
    }, watch!.id)

    expect(bills.length).toBeGreaterThan(0)
    for (const bill of bills) {
      expect(bill.matchedSubjects.some((s) => s.includes('K-12'))).toBe(true)
    }
    const counts = bills.map((b) => b.subjectCount)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))

    await page.locator('[class*="watchCard"]', { hasText: 'E2E K-12 Watch' }).locator('button[class*="matchCount"]').click()
    await expect(page.locator('[class*="matchReason"]', { hasText: 'K-12' }).first()).toBeVisible()
  })
})
