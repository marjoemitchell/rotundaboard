import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill, trackBillWithOutcome, getLastEmail, showClosedBills } from './fixtures'

const OUTCOME_LABELS: Record<string, string> = {
  became_law: 'Became law',
  failed: 'Failed',
  died: 'Died',
}

test.describe('dashboard bill table and drawer', () => {
  test('clicking a tracked bill opens the quick-view drawer, and "View full details" navigates to the full page', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackFirstAvailableBill(page)

    // The only session with real bill data here ended in 2025, so the bill is
    // closed. The table shows it in the "Closed" group, with "—" for momentum.
    // The drawer and the bill page show its outcome badge.
    await page.goto('/')
    await showClosedBills(page)
    const row = page.locator('[role="row"]', { hasText: identifier })
    await expect(row.locator('[class*="momentumCell"]')).toHaveText('—')

    await row.click()
    const drawer = page.locator(`[aria-label="${identifier} details"]`)
    await expect(drawer).toBeVisible()

    // Every scraped bill has an AI summary generated (see server/src/generateSummaries.ts).
    await expect(drawer.locator('text=AI-generated summary')).toBeVisible()
    await expect(drawer.locator('[class*="aiSummaryText"]')).not.toBeEmpty()

    // Links straight to the bill on bills.legmt.gov itself, not just our
    // own full-details page — this is the one URL scheme confirmed to
    // resolve for a bill at any stage (verified against both an enacted
    // law and one that died in committee).
    const drawerOfficialLink = drawer.locator('a', { hasText: 'View on official site' })
    await expect(drawerOfficialLink).toHaveAttribute('href', /^https:\/\/bills\.legmt\.gov\/#\/laws\/bill\/\d+\/[A-Za-z0-9]+\?open_tab=bill$/)

    await expect(drawer.locator('[class*="sectionEyebrow"]', { hasText: 'Outcome' })).toBeVisible()
    await expect(drawer.locator('[class*="badge"]')).toBeVisible()

    await page.click('text=View full details')
    await page.waitForURL(/\/bills\/.+/)
    await expect(page.locator('[aria-label*="details"]')).not.toBeVisible()

    const pageOfficialLink = page.locator('a', { hasText: 'View on official site' })
    await expect(pageOfficialLink).toHaveAttribute('href', /^https:\/\/bills\.legmt\.gov\/#\/laws\/bill\/\d+\/[A-Za-z0-9]+\?open_tab=bill$/)

    await expect(page.locator('.eyebrow', { hasText: 'Outcome' })).toBeVisible()
    await expect(page.locator('[class*="badge"]')).toBeVisible()
  })

  test('"Stop tracking" in the quick-view drawer removes the bill without navigating away', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackFirstAvailableBill(page)

    await page.goto('/')
    await showClosedBills(page)
    await page.locator('[role="row"]', { hasText: identifier }).click()
    const drawer = page.locator(`[aria-label="${identifier} details"]`)
    await expect(drawer).toBeVisible()

    await drawer.locator('button:has-text("Stop tracking")').click()
    await expect(drawer).not.toBeVisible()
    // Stays on the dashboard rather than navigating to the bill's own page.
    await expect(page).toHaveURL('/')
    await expect(page.locator('[role="row"]', { hasText: identifier })).not.toBeVisible()

    await page.goto('/tracking-board')
    await expect(page.locator('text=No bills are being tracked yet')).toBeVisible()
  })
})

test.describe('resolved bills show their real outcome instead of a live momentum tracker', () => {
  test('the outcome badge label matches the bill\'s actual outcome in the drawer and on the full page', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackBillWithOutcome(page)

    const detail = await page.evaluate(async (id) => {
      const res = await fetch(`http://localhost:4000/api/bills/${id}`, { credentials: 'include' })
      return (await res.json()) as { outcome: 'became_law' | 'failed' | 'died' }
    }, billId)
    const expectedLabel = OUTCOME_LABELS[detail.outcome]
    expect(expectedLabel).toBeTruthy()

    // The table keeps the momentum column numeric: a closed bill shows "—".
    await page.goto('/')
    await showClosedBills(page)
    const row = page.locator('[role="row"]', { hasText: identifier })
    await expect(row.locator('[class*="momentumCell"]')).toHaveText('—')

    await row.click()
    const drawer = page.locator(`[aria-label="${identifier} details"]`)
    await expect(drawer.locator('[class*="sectionEyebrow"]', { hasText: 'Outcome' })).toBeVisible()
    await expect(drawer.locator('[class*="momentumHead"] [class*="badge"]')).toHaveText(expectedLabel)

    await page.click('text=View full details')
    await page.waitForURL(/\/bills\/.+/)
    await expect(page.locator('.eyebrow', { hasText: 'Outcome' })).toBeVisible()
    await expect(page.locator('[class*="momentumHead"] [class*="badge"]')).toHaveText(expectedLabel)
  })
})

test.describe('team avatars', () => {
  test('clicking your own avatar in the TopBar filters the dashboard to your bills', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)
    await page.goto('/')

    const avatarButton = page.locator('[aria-label^="Filter bills assigned to"]').first()
    await expect(avatarButton).toBeVisible()
    await avatarButton.click()
    await expect(page.locator('[class*="chipActive"]', { hasText: 'Assignee' })).toBeVisible()
  })
})

test.describe('momentum model', () => {
  test('hiding and re-showing the momentum model persists across a reload', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const heading = page.locator('span.eyebrow', { hasText: 'Momentum model' })
    const showToggle = page.locator('button:has-text("Show momentum model")')

    await page.goto('/')
    await expect(heading).toBeVisible()

    await page.click('button:has-text("Hide")')
    await expect(heading).not.toBeVisible()
    await expect(showToggle).toBeVisible()

    await page.reload()
    await expect(showToggle).toBeVisible()

    await showToggle.click()
    await expect(heading).toBeVisible()
  })
})

test.describe('morning brief', () => {
  test('"Send this brief" emails the live brief to your own address', async ({ page }) => {
    // Digests (a manual generate-and-archive page, no actual delivery) was
    // replaced by this single action — see AIBrief.tsx and
    // mutations.sendBrief. It sends whatever getBrief() returns right now,
    // the same content the dashboard card already shows.
    const info = await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)

    await page.goto('/')
    await page.waitForSelector('text=Morning brief')
    await page.click('button:has-text("Send this brief")')
    await expect(page.locator('text=Brief sent to your email.')).toBeVisible()

    const email = await getLastEmail(page.request, info.email)
    expect(email.subject).toContain('Morning brief')
    expect(email.html).toContain(info.workspaceName)
  })
})

test.describe('dashboard subtitle', () => {
  test('a workspace that tracks no bills does not stay on "Loading"', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')
    await expect(page.getByText(/: your team tracks no bills yet\.$/)).toBeVisible()
    await expect(page.getByText('Loading today’s activity…')).toHaveCount(0)
  })

  test('a workspace with tracked bills shows how many are moving', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)
    await page.goto('/')
    await expect(page.getByText(/: \d+ bills moving this week\.$/)).toBeVisible()
  })

  test('a failed request for the bills shows an error, not "Loading"', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.route('**/api/bills', (route) => route.fulfill({ status: 500, body: '{"error":"test"}' }))
    await page.goto('/')
    await expect(page.getByText('Your bills could not be loaded. Refresh the page to try again.')).toBeVisible()
    await expect(page.getByText('Loading today’s activity…')).toHaveCount(0)
  })
})

test.describe('dashboard filter menus', () => {
  test('the menus list all values, not only the values of the tracked bills', async ({ page }) => {
    await signUpFreshWorkspace(page)
    // One tracked bill has one sponsor party and one committee.
    await trackFirstAvailableBill(page)
    const res = await page.request.get('http://localhost:4000/api/filter-options')
    expect(res.ok()).toBeTruthy()
    const all = (await res.json()) as { committees: string[]; parties: string[]; subjects: string[] }
    expect(all.parties.length).toBeGreaterThan(1)
    expect(all.committees.length).toBeGreaterThan(1)

    await page.goto('/')
    await page.getByLabel('Add filter').selectOption('party')
    const party = page.getByLabel('Party', { exact: true })
    for (const p of all.parties) await expect(party.locator('option', { hasText: new RegExp(`^${p}$`) })).toHaveCount(1)

    await page.getByLabel('Add filter').selectOption('committee')
    const committee = page.getByLabel('Committee', { exact: true })
    await expect(committee.locator('option')).toHaveCount(all.committees.length)
  })
})
