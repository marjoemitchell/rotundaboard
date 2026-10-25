import { test, expect, signUpFreshWorkspace, trackOneLcAndOneIntroducedBill, findSessionIdWithBills, showClosedBills } from './fixtures'

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
    await showClosedBills(page)
    await expect(page.locator('[role="row"]', { hasText: lc.identifier })).toBeVisible()
    await expect(page.locator('[role="row"]', { hasText: introduced.identifier })).toBeVisible()
    await expect(nav.getByText('Browse sessions')).toHaveCount(0)
  })

  test('All bills lists every bill of the session, and LC drafts and Introduced filter it', async ({ page }) => {
    // The fixture opens two bill pages to track the bills. Under a parallel
    // run, this test can need more than the default 30 seconds.
    test.slow()
    await signUpFreshWorkspace(page)
    const { lc, introduced } = await trackOneLcAndOneIntroducedBill(page)
    const nav = page.locator('nav[aria-label="Primary"]')
    const rows = page.getByRole('table', { name: 'Bills' }).locator('a[role="row"]')

    await nav.getByRole('button', { name: 'All bills' }).click()
    await expect(page).toHaveURL(/\/bills$/)
    await expect(page.locator('h1', { hasText: 'All bills' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'All bills' })).toHaveAttribute('aria-current', 'page')
    // The tracked bills are in the session with the most bills (2025).
    const trackedSession = await findSessionIdWithBills(page)
    const ordinals = await page.evaluate(async (id) => {
      const res = await fetch('http://localhost:4000/api/sessions', { credentials: 'include' })
      return ((await res.json()) as { id: string; ordinals: string }[]).find((x) => x.id === id)!.ordinals
    }, trackedSession)
    await page
      .getByRole('group', { name: 'Session' })
      .getByRole('button', { name: new RegExp(`^${ordinals.slice(0, 4)} session`) })
      .click()
    // The page shows 100 rows first, not the whole session.
    await expect(rows).toHaveCount(100)
    await expect(page.getByRole('button', { name: /^Show more/ })).toBeVisible()

    // Search finds a tracked bill, and its Track button shows "Tracked".
    await page.getByPlaceholder('Search by bill number, title, or sponsor').fill(introduced.identifier)
    await expect(page.getByRole('button', { name: `Stop tracking ${introduced.identifier}`, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

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

  test('each session and type click changes the list at once, with no page reload', async ({ page }) => {
    await signUpFreshWorkspace(page)
    // Open drafts in the upcoming session, so that both sessions have bills.
    // A day old, so that they do not push the drafts of the dashboard specs out of the newest suggestions.
    const res = await page.request.post('http://localhost:4000/api/__test__/open-drafts', { data: { count: 3, ageMinutes: 1440 } })
    const drafts = (await res.json()).bills as { identifier: string; title: string }[]
    const sessions = await page.evaluate(async () => {
      const r = await fetch('http://localhost:4000/api/sessions', { credentials: 'include' })
      return (await r.json()) as { id: string; ordinals: string; startDate: string | null; billCount: number }[]
    })
    const old = [...sessions].sort((a, b) => b.billCount - a.billCount)[0]
    const upcoming = sessions.find((s) => s.id !== old.id && s.ordinals > old.ordinals)
    test.skip(!upcoming, 'needs an upcoming session')
    const year = (s: { ordinals: string }) => new RegExp(`^${s.ordinals.slice(0, 4)} session`)
    const sessionTabs = page.getByRole('group', { name: 'Session' })
    const typeTabs = page.getByRole('group', { name: 'Bill type' })
    const rows = page.getByRole('table', { name: 'Bills' }).locator('a[role="row"]')

    // No session in the URL: the page picks the newest session with bills.
    // (The bug occurred from this start: a tab click changed the URL, but the
    // list kept the bills of the session before.)
    const search = page.getByPlaceholder('Search by bill number, title, or sponsor')
    await page.goto('/bills')
    await expect(rows.first()).toBeVisible()
    const startedOnOld = (await sessionTabs.getByRole('button', { name: year(old) }).getAttribute('aria-pressed')) === 'true'
    if (!startedOnOld) {
      await sessionTabs.getByRole('button', { name: year(old) }).click()
      await expect(rows.filter({ hasText: drafts[0].title })).toHaveCount(0)
    }
    await expect(rows).toHaveCount(100)

    await sessionTabs.getByRole('button', { name: year(upcoming!) }).click()
    // The upcoming session can have many real drafts, so find the fixture by its title.
    await search.fill(drafts[0].title)
    await expect(rows.filter({ hasText: drafts[0].title })).toBeVisible()
    await search.fill('')
    await expect(page.locator('[class*="resultCount"]')).not.toContainText('4,')

    await typeTabs.getByRole('button', { name: /^LC drafts/ }).click()
    await search.fill(drafts[0].title)
    await expect(rows.filter({ hasText: drafts[0].title })).toBeVisible()
    await search.fill('')

    await sessionTabs.getByRole('button', { name: year(old) }).click()
    await expect(rows.filter({ hasText: drafts[0].title })).toHaveCount(0)
    await expect(rows).toHaveCount(100)
    await expect(rows.locator('[class*="identifier"]').filter({ hasNotText: /^LC/ })).toHaveCount(0)

    await typeTabs.getByRole('button', { name: /^Introduced/ }).click()
    await expect(rows.locator('[class*="identifier"]').filter({ hasText: /^LC/ })).toHaveCount(0)
    await expect(rows.first()).toBeVisible()
  })

  test('going back to a session shows its bills at once, also while the refresh is slow', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const sessions = await page.evaluate(async () => {
      const res = await fetch('http://localhost:4000/api/sessions', { credentials: 'include' })
      return (await res.json()) as { id: string; ordinals: string; billCount: number }[]
    })
    test.skip(sessions.length < 2, 'needs two sessions')
    const withBills = [...sessions].sort((a, b) => b.billCount - a.billCount)[0]
    const other = sessions.find((s) => s.id !== withBills.id)!
    const button = (s: { ordinals: string }) =>
      page.getByRole('group', { name: 'Session' }).getByRole('button', { name: new RegExp(`^${s.ordinals.slice(0, 4)} session`) })
    const rows = page.getByRole('table', { name: 'Bills' }).locator('a[role="row"]')

    await page.goto(`/bills?session=${withBills.id}`)
    await expect(rows.first()).toBeVisible()
    await button(other).click()
    await expect(button(other)).toHaveAttribute('aria-pressed', 'true')

    // The next request for the session takes 8 seconds.
    await page.route(`**/api/sessions/${withBills.id}/bills`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8000))
      await route.continue().catch(() => undefined)
    })
    await button(withBills).click()
    await expect(rows.first()).toBeVisible({ timeout: 2000 })
  })

  test('a failed request shows an error, and "Try again" loads the bills', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const sessionId = await findSessionIdWithBills(page)
    await page.route(`**/api/sessions/${sessionId}/bills`, (route) => route.fulfill({ status: 502, body: 'Bad gateway' }))

    await page.goto(`/bills?session=${sessionId}`)
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('The bills could not be loaded.')
    await expect(page.getByText('No bills found for this session yet.')).toHaveCount(0)

    await page.unroute(`**/api/sessions/${sessionId}/bills`)
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('table', { name: 'Bills' }).locator('a[role="row"]').first()).toBeVisible()
  })

  test('Track on a row tracks the bill, the Tracked tab lists it, and Stop tracking removes it', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const sessionId = await findSessionIdWithBills(page)
    await page.goto(`/bills?session=${sessionId}`)
    const rows = page.getByRole('table', { name: 'Bills' }).locator('a[role="row"]')
    const typeTabs = page.getByRole('group', { name: 'Bill type' })
    await expect(typeTabs.getByRole('button', { name: /^Tracked/ })).toHaveText('Tracked0')

    const identifier = (await rows.first().locator('[class*="identifier"]').textContent())!.trim()
    const trackButton = page.getByRole('button', { name: `Track ${identifier}`, exact: true })
    await expect(trackButton).toHaveAttribute('aria-pressed', 'false')
    await trackButton.click()
    await expect(page.getByText(`Tracking ${identifier}.`)).toBeVisible()
    const stopButton = page.getByRole('button', { name: `Stop tracking ${identifier}`, exact: true })
    await expect(stopButton).toHaveAttribute('aria-pressed', 'true')
    // The page stays: a click on Track does not open the bill.
    await expect(page).toHaveURL(new RegExp(`/bills\\?session=${sessionId}`))

    // The Tracked tab lists only the tracked bill.
    await typeTabs.getByRole('button', { name: /^Tracked/ }).click()
    await expect(typeTabs.getByRole('button', { name: /^Tracked/ })).toHaveText('Tracked1')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(identifier)

    // The bill page agrees.
    await rows.first().click()
    await expect(page.getByRole('button', { name: 'Stop tracking' })).toBeVisible()
    await page.goBack()

    // Stop tracking from the list: the Tracked tab is empty.
    await page.getByRole('button', { name: `Stop tracking ${identifier}`, exact: true }).click()
    await expect(page.getByText(`Stopped tracking ${identifier}.`)).toBeVisible()
    await expect(rows).toHaveCount(0)
    await expect(page.getByText('Your team tracks no bills in this session.')).toBeVisible()
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
