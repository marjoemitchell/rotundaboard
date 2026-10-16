import { test, expect, signUpFreshWorkspace, trackOneLcAndOneIntroducedBill, findSessionIdWithBills } from './fixtures'

test.describe('Dashboard and All bills navigation', () => {
  test('Dashboard is the first nav item and shows the tracked bills', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { lc, introduced } = await trackOneLcAndOneIntroducedBill(page)
    const nav = page.locator('nav[aria-label="Primary"]')

    await page.goto('/hearings')
    await expect(nav.getByRole('button').first()).toHaveText(/^Dashboard/)
    await nav.getByRole('button', { name: /^Dashboard/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('h1', { hasText: 'Dashboard' })).toBeVisible()
    await expect(nav.getByRole('button', { name: /^Dashboard/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('[role="row"]', { hasText: lc.identifier })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: introduced.identifier })).toBeVisible()
    await expect(nav.getByText('Browse sessions')).toHaveCount(0)
  })

  test('All bills lists every bill of the session, and LC drafts and Introduced filter it', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { lc, introduced } = await trackOneLcAndOneIntroducedBill(page)
    const nav = page.locator('nav[aria-label="Primary"]')
    const rows = page.getByRole('table', { name: 'Bills' }).locator('a[role="row"]')

    await nav.getByRole('button', { name: 'All bills' }).click()
    await expect(page).toHaveURL(/\/bills$/)
    await expect(page.locator('h1', { hasText: 'All bills' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'All bills' })).toHaveAttribute('aria-current', 'page')
    // The page shows 100 rows first, not the whole session.
    await expect(rows).toHaveCount(100)
    await expect(page.getByRole('button', { name: /^Show more/ })).toBeVisible()

    // Search finds a tracked bill, with its badge.
    await page.getByPlaceholder('Search by bill number, title, or sponsor').fill(introduced.identifier)
    await expect(rows.filter({ hasText: introduced.identifier }).first()).toContainText('Tracked')

    await nav.getByRole('button', { name: 'LC drafts' }).click()
    await expect(page).toHaveURL(/type=lc/)
    await expect(nav.getByRole('button', { name: 'LC drafts' })).toHaveAttribute('aria-current', 'page')
    await page.getByPlaceholder('Search by bill number, title, or sponsor').fill(lc.identifier)
    await expect(rows.filter({ hasText: lc.identifier }).first()).toBeVisible()
    await expect(rows.locator('[class*="identifier"]').filter({ hasNotText: /^LC/ })).toHaveCount(0)

    await nav.getByRole('button', { name: 'Introduced (HB / SB)' }).click()
    await expect(page).toHaveURL(/type=introduced/)
    await expect(rows.first()).toBeVisible()
    await expect(rows.locator('[class*="identifier"]').filter({ hasText: /^LC/ })).toHaveCount(0)
  })

  test('the session switch changes the session, and the choice stays', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const sessions = await page.evaluate(async () => {
      const res = await fetch('http://localhost:4000/api/sessions', { credentials: 'include' })
      return (await res.json()) as { id: string; ordinals: string; billCount: number }[]
    })
    test.skip(sessions.length < 2, 'needs two sessions')
    const withBills = [...sessions].sort((a, b) => b.billCount - a.billCount)[0]
    const other = sessions.find((s) => s.id !== withBills.id)!

    await page.goto('/bills')
    const switcher = page.getByRole('group', { name: 'Session' })
    await expect(switcher.getByRole('button')).toHaveCount(sessions.length)
    await switcher.getByRole('button', { name: new RegExp(`^${other.ordinals.slice(0, 4)} session`) }).click()
    await expect(page).toHaveURL(new RegExp(`session=${other.id}`))
    await expect(switcher.getByRole('button', { name: new RegExp(`^${other.ordinals.slice(0, 4)} session`) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // The nav item opens the session that the person chose last.
    await page.locator('nav[aria-label="Primary"]').getByRole('button', { name: 'All bills' }).click()
    await expect(switcher.getByRole('button', { name: new RegExp(`^${other.ordinals.slice(0, 4)} session`) })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await switcher.getByRole('button', { name: new RegExp(`^${withBills.ordinals.slice(0, 4)} session`) }).click()
    await expect(page.getByRole('table', { name: 'Bills' }).locator('a[role="row"]').first()).toBeVisible()
  })

  test('an old session bills link opens All bills for that session', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const sessionId = await findSessionIdWithBills(page)
    await page.goto(`/sessions/${sessionId}`)
    await expect(page).toHaveURL(new RegExp(`/bills\\?session=${sessionId}$`))
    await expect(page.locator('h1', { hasText: 'All bills' })).toBeVisible()
  })
})

test.describe('Hearings page', () => {
  test('the nav item opens a real hearings list, searchable, linking to the committee', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')

    await page.locator('nav[aria-label="Primary"] button', { hasText: 'Hearings' }).click()
    await page.waitForURL('/hearings')
    await expect(page.locator('h1', { hasText: 'Hearings' })).toBeVisible()

    const firstRow = page.locator('a[class*="row"]').first()
    await expect(firstRow).toBeVisible()
    const committeeName = (await firstRow.locator('span[class*="rowCommittee"]').textContent())?.trim() ?? ''
    expect(committeeName).toBeTruthy()

    await page.fill('input[placeholder="Search by committee"]', 'zzzznomatch')
    await expect(page.locator('a[class*="row"]')).toHaveCount(0)
    await page.fill('input[placeholder="Search by committee"]', committeeName)
    await expect(page.locator('a[class*="row"]', { hasText: committeeName }).first()).toBeVisible()

    await page.locator('a[class*="row"]', { hasText: committeeName }).first().click()
    await page.waitForURL(/\/committees\/.+/)
    await expect(page.locator('h1', { hasText: committeeName })).toBeVisible()
  })

  test('hearing times render as real Mountain wall-clock times, not shifted by a timezone bug', async ({ page }) => {
    // Regression test: a plain TIMESTAMP (no time zone) column holding a
    // naive Mountain-local value (e.g. "08:00:00") used to round-trip
    // through node-postgres's default OID 1114 parser as if it were UTC,
    // then get shifted again on display — turning a real 8am hearing into
    // "2am". See server/src/db.ts's setTypeParser(1114, ...) fix.
    await signUpFreshWorkspace(page)
    await page.goto('/hearings')
    await expect(page.locator('a[class*="row"]').first()).toBeVisible()

    const times = await page.locator('[class*="rowDateTime"]').allTextContents()
    expect(times.length).toBeGreaterThan(0)
    for (const t of times) {
      // No real legislative hearing is scheduled overnight — this is the
      // exact symptom the timezone bug produced (an 8am hearing rendering
      // as "2:00 AM").
      expect(t).not.toMatch(/^\s*(12|[1-5]):\d{2}\s*AM/i)
    }
  })

  test('following a committee highlights its hearing rows', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/hearings')
    await page.waitForSelector('a[class*="row"]')

    const firstRow = page.locator('a[class*="row"]').first()
    const committeeName = (await firstRow.locator('span[class*="rowCommittee"]').textContent())?.trim() ?? ''
    await expect(page.locator('[class*="followingBadge"]')).toHaveCount(0)

    await firstRow.click()
    await page.waitForURL(/\/committees\/.+/)
    await page.click('button:has-text("+ Follow")')
    await page.waitForSelector('button:has-text("Following")')

    await page.goto('/hearings')
    await page.waitForSelector('a[class*="row"]')
    const followedRows = page.locator('a[class*="row"]', { hasText: committeeName })
    const count = await followedRows.count()
    for (let i = 0; i < count; i++) {
      await expect(followedRows.nth(i).locator('[class*="followingBadge"]')).toBeVisible()
    }
    await expect(page.locator('[class*="followingBadge"]')).toHaveCount(count)
  })
})
