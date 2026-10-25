import { test, expect, signUpFreshWorkspace, createHearingFixture, uniqueSuffix } from './fixtures'

const API_BASE = 'http://localhost:4000'

test.describe('interim committees', () => {
  test('following a committee from the list page shows it followed, and searching filters the list', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/committees')
    await expect(page.locator('div[class^="_row_"]').first()).toBeVisible()

    const firstRow = page.locator('div[class^="_row_"]').first()
    const name = (await firstRow.locator('[class*="rowName"]').textContent())?.trim() ?? ''
    expect(name).toBeTruthy()
    await firstRow.locator('button', { hasText: '+ Follow' }).click()
    await expect(firstRow.locator('button', { hasText: 'Following' })).toBeVisible()

    await page.fill('input[placeholder="Search committees"]', 'zzzznomatch')
    await expect(page.locator('div[class^="_row_"]')).toHaveCount(0)
    await page.fill('input[placeholder="Search committees"]', '')
    await expect(page.locator('div[class^="_row_"]', { hasText: name })).toBeVisible()
  })

  test('a followed committee changes the dashboard "Coming up" list, and unfollowing from the detail page works', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/committees')
    const firstRow = page.locator('div[class^="_row_"]').first()
    const name = (await firstRow.locator('[class*="rowName"]').textContent())?.trim() ?? ''
    await firstRow.locator('a[class*="rowMain"]').click()
    await page.waitForURL(/\/committees\/.+/)

    // committees.legmt.gov is a hash-routed SPA — a plain-path link 404s at
    // the server before React Router ever sees it, so the href must keep
    // the "#" (see CommitteeDetailPage.tsx).
    const officialLink = page.locator('a', { hasText: 'View on official site' })
    await expect(officialLink).toBeVisible()
    await expect(officialLink).toHaveAttribute('href', /^https:\/\/committees\.legmt\.gov\/#\/nonStandingCommittees\/\d+$/)
    await page.locator('button', { hasText: '+ Follow' }).click()
    await expect(page.locator('button', { hasText: 'Following' })).toBeVisible()

    // With a meeting in the next 30 days, the committee is a row. Without
    // one, the list says that no followed committee meets soon.
    await page.goto('/')
    const comingUp = page.getByRole('region', { name: 'Coming up' })
    await expect(comingUp.getByRole('link', { name }).or(comingUp.getByText('No followed committees meet in the next 30 days.'))).toBeVisible()
    await expect(comingUp.getByText('Follow an interim committee to see its meetings here.')).toHaveCount(0)

    await page.goBack()
    await page.waitForURL(/\/committees\/.+/)
    await page.locator('button', { hasText: 'Following' }).click()
    await expect(page.locator('button', { hasText: '+ Follow' })).toBeVisible()
  })

  test('a committee with published meeting materials shows them, with working document links', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/committees')
    await expect(page.locator('div[class^="_row_"]').first()).toBeVisible()
    const rowLinks = page.locator('a[class*="rowMain"]')
    const count = await rowLinks.count()
    expect(count).toBeGreaterThan(0)

    // Not every committee has published materials — check rows until one
    // does, rather than assuming a specific committee (data comes from a
    // live scrape, not a fixture).
    let found = false
    for (let i = 0; i < Math.min(count, 15); i++) {
      await page.goto('/committees')
      await rowLinks.nth(i).click()
      await page.waitForURL(/\/committees\/.+/)
      if (await page.locator('.eyebrow', { hasText: 'Meeting materials' }).isVisible()) {
        found = true
        break
      }
    }
    expect(found).toBe(true)

    const materialsLink = page.locator('[class*="materials"] a').first()
    await expect(materialsLink).toBeVisible()
    await expect(materialsLink).toHaveAttribute('href', /^https:\/\//)
  })
})

test.describe('meeting recordings', () => {
  test('a past meeting with a recording links to the recording page and to the official video', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const room = `Room E2E ${uniqueSuffix()}`
    const res = await page.request.post(`${API_BASE}/api/__test__/committee-meeting`, {
      data: { daysFromNow: -2, location: room, agenda: ['Agency reports'] },
    })
    expect(res.ok()).toBeTruthy()
    const meeting = (await res.json()) as { committeeId: string; meetingId: number }
    const recording = await createHearingFixture(page.request, {
      meetingId: meeting.meetingId,
      durationSeconds: 5400,
      segments: [{ start: 0, end: 5, text: 'The committee will come to order.' }],
    })

    await page.goto(`/committees/${meeting.committeeId}`)
    const row = page.locator('[class*="meetingRow"]').filter({ hasText: room })
    await expect(row).toContainText('Past')
    const recordings = row.getByRole('list', { name: 'Recordings' })
    await expect(recordings).toContainText('1h 30m')
    await expect(recordings.getByRole('link', { name: 'Official video ↗' })).toHaveAttribute(
      'href',
      /^https:\/\/streaming-video\.legmt\.gov\/browse\/item\//,
    )

    await recordings.getByRole('link', { name: 'Recording' }).click()
    await expect(page).toHaveURL(new RegExp(`/hearings/recordings/${recording.id}$`))
    await expect(page.getByText('The committee will come to order.')).toBeVisible()
  })

  test('a meeting without a recording shows no recording link', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const room = `Room E2E ${uniqueSuffix()}`
    const res = await page.request.post(`${API_BASE}/api/__test__/committee-meeting`, {
      data: { daysFromNow: -3, location: room },
    })
    const meeting = (await res.json()) as { committeeId: string }

    await page.goto(`/committees/${meeting.committeeId}`)
    const row = page.locator('[class*="meetingRow"]').filter({ hasText: room })
    await expect(row).toContainText('Past')
    await expect(row.getByRole('list', { name: 'Recordings' })).toHaveCount(0)
  })
})
