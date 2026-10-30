import type { Browser, Page } from '@playwright/test'
import { test, expect, createHearingFixture, findSessionIdWithBills, signUpFreshWorkspace, uniqueSuffix } from './fixtures'

const API_BASE = 'http://localhost:4000'

// A visitor has no session, so a signed-in page finds the bill ids.
async function sessionBills(page: Page): Promise<{ id: string; identifier: string; title: string }[]> {
  const sessionId = await findSessionIdWithBills(page)
  return (await page.request.get(`${API_BASE}/api/sessions/${sessionId}/bills`)).json()
}

async function visitorPage(browser: Browser) {
  const context = await browser.newContext()
  return { context, page: await context.newPage() }
}

test.describe('public bill page', () => {
  test('a visitor without an account sees the bill, with no workspace controls', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const [bill] = await sessionBills(page)

    const visitor = await visitorPage(browser)
    await visitor.page.goto(`/bills/${bill.id}`)
    await expect(visitor.page).toHaveURL(new RegExp(`/bills/${bill.id}$`))
    await expect(visitor.page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(visitor.page.getByText(bill.identifier, { exact: true }).first()).toBeVisible()
    await expect(visitor.page.getByText('Track this bill and get an email when it has a hearing')).toBeVisible()
    await expect(visitor.page.getByRole('link', { name: 'Sign up free' }).first()).toBeVisible()

    await expect(visitor.page.getByRole('button', { name: '+ Track this bill' })).toHaveCount(0)
    await expect(visitor.page.getByRole('region', { name: 'Testimony' })).toHaveCount(0)
    await expect(visitor.page.getByPlaceholder('Add a note about this bill…')).toHaveCount(0)
    await expect(visitor.page.getByRole('button', { name: '← Back' })).toHaveCount(0)
    await visitor.context.close()
  })

  test('a visitor who signs up from a bill page comes back to the bill and can track it', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const [bill] = await sessionBills(page)

    const visitor = await visitorPage(browser)
    await visitor.page.goto(`/bills/${bill.id}`)
    await visitor.page.getByRole('link', { name: 'Sign up free' }).first().click()
    await expect(visitor.page).toHaveURL(/\/signup/)
    const suffix = uniqueSuffix()
    await visitor.page.fill('#workspaceName', `E2E Workspace ${suffix}`)
    await visitor.page.fill('#name', 'E2E Visitor')
    await visitor.page.fill('#email', `e2e-visitor-${suffix}@example.dev`)
    await visitor.page.fill('#password', 'e2e-test-password-1')
    await visitor.page.click('button[type="submit"]')

    await expect(visitor.page).toHaveURL(new RegExp(`/bills/${bill.id}$`))
    await visitor.page.getByRole('button', { name: '+ Track this bill' }).click()
    await expect(visitor.page.getByRole('button', { name: 'Stop tracking' })).toBeVisible()
    await visitor.context.close()
  })

  test('a visitor who logs in from a bill page comes back to the bill', async ({ page, browser }) => {
    const info = await signUpFreshWorkspace(page)
    const [bill] = await sessionBills(page)

    const visitor = await visitorPage(browser)
    await visitor.page.goto(`/bills/${bill.id}`)
    await visitor.page.getByRole('link', { name: 'Log in' }).first().click()
    await visitor.page.fill('input[type="email"]', info.email)
    await visitor.page.fill('input[type="password"]', info.password)
    await visitor.page.click('button[type="submit"]')
    await expect(visitor.page).toHaveURL(new RegExp(`/bills/${bill.id}$`))
    await expect(visitor.page.getByRole('button', { name: '+ Track this bill' })).toBeVisible()
    await visitor.context.close()
  })

  test('a visitor gets the amendment changes but not the AI amendment summary', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const bill = (await sessionBills(page))[16]
    const n = Math.floor(Math.random() * 1_000_000) + 1
    const summary = 'This amendment lowers the license fee to $35.'
    const res = await page.request.post(`${API_BASE}/api/__test__/bill-text`, {
      data: { billId: Number(bill.id), amendmentId: -n, documentId: -n * 4, summary },
    })
    expect(res.ok()).toBeTruthy()

    const visitor = await visitorPage(browser)
    await visitor.page.goto(`/bills/${bill.id}`)
    const amendments = visitor.page.getByRole('region', { name: 'Amendments' })
    await expect(amendments.getByText('AI summaries of these amendments are included in the paid plans.')).toBeVisible()
    await expect(amendments.getByRole('link', { name: 'Sign up' })).toBeVisible()
    await expect(amendments.getByText(summary)).toHaveCount(0)

    const amendment = amendments.getByTestId('amendment').filter({ hasText: `Amendment #${n % 1_000_000}` })
    await amendment.getByRole('button', { name: 'Show the changes' }).click()
    await expect(amendment.getByRole('region', { name: /^Changes of Amendment/ })).toBeVisible()
    await visitor.context.close()
  })

  test('on a phone, the signup prompt is on the first screen and the page has no sideways scroll', async ({
    page,
    browser,
  }) => {
    await signUpFreshWorkspace(page)
    const [bill] = await sessionBills(page)

    const context = await browser.newContext({ viewport: { width: 375, height: 640 } })
    const visitor = await context.newPage()
    await visitor.goto(`/bills/${bill.id}`)
    const prompt = visitor.locator('[aria-label="Track this bill"]')
    const button = prompt.getByRole('link', { name: 'Sign up free' })
    await expect(button).toBeInViewport({ ratio: 1 })
    // The button is right under the text of the prompt (two lines on a
    // phone), with no empty space.
    const text = await prompt.getByText('Track this bill and get an email when it has a hearing').boundingBox()
    const buttonBox = await button.boundingBox()
    expect(buttonBox!.y - text!.y).toBeLessThan(80)
    const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await context.close()
  })

  test('a visitor who opens a workspace page goes to the login page', async ({ browser }) => {
    const visitor = await visitorPage(browser)
    await visitor.page.goto('/tracking-board')
    await expect(visitor.page).toHaveURL(/\/login/)
    await visitor.page.goto('/legislators/map-not-a-page')
    await expect(visitor.page).toHaveURL(/\/login/)
    await visitor.page.goto('/bills/1/compare')
    await expect(visitor.page).toHaveURL(/\/login/)
    await visitor.context.close()
  })
})

test.describe('public legislator pages', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: 'County details' })

  test('a visitor can use the county map and open a legislator, with no tracked counts', async ({ browser }) => {
    const visitor = await visitorPage(browser)
    await visitor.page.goto('/legislators')
    await expect(visitor.page.locator('h1', { hasText: 'Legislators by county' })).toBeVisible()
    await expect(visitor.page.locator('path[data-county]')).toHaveCount(56)
    await expect(visitor.page.getByRole('link', { name: 'Sign up free' })).toBeVisible()

    await visitor.page.locator('path[data-county="Yellowstone"]').click()
    await visitor.page.mouse.move(0, 0)
    await expect(panel(visitor.page)).toContainText('Yellowstone County')
    await expect(panel(visitor.page)).not.toContainText('Sponsor tracked')
    await expect(panel(visitor.page)).not.toContainText('tracked')
    await expect(visitor.page.getByText('your team tracks')).toHaveCount(0)

    // A member opens the legislator page, and a sponsored bill opens the public bill page.
    const member = panel(visitor.page).getByRole('list', { name: 'Senate members' }).getByRole('link').first()
    const name = (await member.textContent())!.replace(/^Sen\.\s*/, '')
    await member.click()
    await expect(visitor.page).toHaveURL(/\/legislators\/\d+$/)
    await expect(visitor.page.getByRole('heading', { level: 1 })).toContainText(name.split(' ').pop()!)
    await expect(visitor.page.getByRole('button', { name: '← Back' })).toHaveCount(0)
    await visitor.context.close()
  })

  test('a visitor can search the legislator list', async ({ browser, playwright }) => {
    const anonymous = await playwright.request.newContext()
    const legislators = (await (await anonymous.get(`${API_BASE}/api/public/legislators`)).json()) as { id: string; name: string }[]
    await anonymous.dispose()
    const target = legislators[0]
    const lastName = target.name.split(' ').pop()!

    const visitor = await visitorPage(browser)
    await visitor.page.goto('/legislators/list')
    const table = visitor.page.getByRole('table', { name: 'Legislators' })
    await expect(table.locator(`a[href="/legislators/${target.id}"]`)).toBeVisible()
    await visitor.page.getByPlaceholder('Search by name or district').fill('zzzz-no-such-legislator')
    await expect(table.locator(`a[href="/legislators/${target.id}"]`)).toHaveCount(0)
    await visitor.page.getByPlaceholder('Search by name or district').fill(lastName)
    await expect(table.locator(`a[href="/legislators/${target.id}"]`)).toBeVisible()
    await visitor.context.close()
  })

  test('a sponsored bill on a legislator page opens the public bill page', async ({ browser, playwright }) => {
    const anonymous = await playwright.request.newContext()
    const legislators = (await (await anonymous.get(`${API_BASE}/api/public/legislators`)).json()) as { id: string }[]
    let found: { legislatorId: string; billId: string } | null = null
    for (const l of legislators.slice(0, 40)) {
      const detail = await (await anonymous.get(`${API_BASE}/api/public/legislators/${l.id}`)).json()
      if (detail.sponsoredBills?.length) {
        found = { legislatorId: l.id, billId: String(detail.sponsoredBills[0].id) }
        break
      }
    }
    await anonymous.dispose()
    expect(found).not.toBeNull()

    const visitor = await visitorPage(browser)
    await visitor.page.goto(`/legislators/${found!.legislatorId}`)
    await visitor.page.locator(`a[href="/bills/${found!.billId}"]`).first().click()
    await expect(visitor.page).toHaveURL(new RegExp(`/bills/${found!.billId}$`))
    await expect(visitor.page.getByText('Track this bill and get an email when it has a hearing')).toBeVisible()
    await visitor.context.close()
  })
})

test.describe('public committee and hearing pages', () => {
  test('a visitor can open a committee, and "Follow" explains signup, then follows the committee after signup', async ({
    browser,
    playwright,
  }) => {
    const api = await playwright.request.newContext()
    const committees = (await (await api.get(`${API_BASE}/api/public/committees`)).json()) as { id: string; name: string }[]
    await api.dispose()
    const committee = committees[0]

    const visitor = await visitorPage(browser)
    await visitor.page.goto('/committees')
    await expect(visitor.page.getByRole('heading', { name: 'Interim committees' })).toBeVisible()
    await visitor.page.getByRole('link', { name: committee.name }).first().click()
    await expect(visitor.page).toHaveURL(new RegExp(`/committees/${committee.id}$`))
    await expect(visitor.page.getByRole('heading', { level: 1 })).toHaveText(committee.name)

    // The click opens a popover. The page stays the same.
    await visitor.page.getByRole('button', { name: '+ Follow' }).click()
    const popover = visitor.page.getByRole('dialog', { name: 'Create an account' })
    await expect(popover).toContainText('Create a free account to follow this committee.')
    await expect(visitor.page).toHaveURL(new RegExp(`/committees/${committee.id}$`))
    await expect(popover.getByRole('link', { name: 'Sign up free' })).toBeFocused()

    await popover.getByRole('link', { name: 'Sign up free' }).click()
    await expect(visitor.page).toHaveURL(/\/signup/)
    const suffix = uniqueSuffix()
    await visitor.page.fill('#workspaceName', `E2E Workspace ${suffix}`)
    await visitor.page.fill('#name', 'E2E Visitor')
    await visitor.page.fill('#email', `e2e-visitor-${suffix}@example.dev`)
    await visitor.page.fill('#password', 'e2e-test-password-1')
    await visitor.page.click('button[type="submit"]')

    // Signup finishes the action: the committee is followed, with no second click.
    await expect(visitor.page).toHaveURL(new RegExp(`/committees/${committee.id}$`))
    await expect(visitor.page.getByRole('button', { name: 'Following' })).toBeVisible()
    await visitor.page.reload()
    await expect(visitor.page.getByRole('button', { name: 'Following' })).toBeVisible()
    await visitor.context.close()
  })

  test('a visitor who logs in from "Follow" on the committee list follows the committee', async ({ page, browser, playwright }) => {
    const info = await signUpFreshWorkspace(page)
    const api = await playwright.request.newContext()
    const committees = (await (await api.get(`${API_BASE}/api/public/committees`)).json()) as { id: string; name: string }[]
    await api.dispose()
    const committee = committees[0]

    const visitor = await visitorPage(browser)
    await visitor.page.goto('/committees')
    const row = visitor.page.locator('[class*="row"]', { has: visitor.page.getByRole('link', { name: committee.name }) }).first()
    await row.getByRole('button', { name: '+ Follow' }).click()
    await visitor.page.getByRole('dialog', { name: 'Create an account' }).getByRole('link', { name: 'Log in' }).click()
    await visitor.page.fill('input[type="email"]', info.email)
    await visitor.page.fill('input[type="password"]', info.password)
    await visitor.page.click('button[type="submit"]')

    await expect(visitor.page).toHaveURL(/\/committees$/)
    await expect(row.getByRole('button', { name: 'Following' })).toBeVisible()
    await visitor.context.close()
  })

  test('Escape and a click outside close the signup popover', async ({ browser }) => {
    const visitor = await visitorPage(browser)
    await visitor.page.goto('/committees')
    const follow = visitor.page.getByRole('button', { name: '+ Follow' }).first()
    const popover = visitor.page.getByRole('dialog', { name: 'Create an account' })

    await follow.click()
    await expect(popover).toBeVisible()
    await expect(follow).toHaveAttribute('aria-expanded', 'true')
    await visitor.page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(follow).toBeFocused()

    await follow.click()
    await expect(popover).toBeVisible()
    await visitor.page.getByRole('heading', { name: 'Interim committees' }).click()
    await expect(popover).toHaveCount(0)
    await visitor.context.close()
  })

  test('a visitor sees the hearings, and signup from a recording opens the recording', async ({ page, browser }) => {
    const recording = await createHearingFixture(page.request, { segments: [{ start: 0, end: 5, text: 'Good morning.' }] })

    const visitor = await visitorPage(browser)
    await visitor.page.goto('/hearings')
    await expect(visitor.page.getByRole('heading', { name: 'Hearings', level: 1 })).toBeVisible()
    const recordings = visitor.page.getByRole('region', { name: 'Recent recordings' })
    await expect(recordings.getByText('Sign up free to listen to a recording and read its transcript.')).toBeVisible()
    await expect(recordings.locator(`a[href="/hearings/recordings/${recording.id}"]`)).toHaveCount(0)

    await recordings.getByRole('button', { name: new RegExp(recording.committee) }).first().click()
    const popover = recordings.getByRole('dialog', { name: 'Create an account' })
    await expect(popover).toContainText('Create a free account to listen to this recording.')
    await popover.getByRole('link', { name: 'Sign up free' }).click()
    const suffix = uniqueSuffix()
    await visitor.page.fill('#workspaceName', `E2E Workspace ${suffix}`)
    await visitor.page.fill('#name', 'E2E Visitor')
    await visitor.page.fill('#email', `e2e-visitor-${suffix}@example.dev`)
    await visitor.page.fill('#password', 'e2e-test-password-1')
    await visitor.page.click('button[type="submit"]')
    await expect(visitor.page).toHaveURL(/\/hearings\/recordings\/[^/]+$/)
    await visitor.context.close()

    // The transcript page itself needs an account.
    const other = await visitorPage(browser)
    await other.page.goto(`/hearings/recordings/${recording.id}`)
    await expect(other.page).toHaveURL(/\/login/)
    await other.context.close()
  })

  test('on a phone, the signup popover fits on the screen', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 700 } })
    const visitor = await context.newPage()
    await visitor.goto('/committees')
    await visitor.getByRole('button', { name: '+ Follow' }).first().click()
    const box = await visitor.getByRole('dialog', { name: 'Create an account' }).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    await context.close()
  })

  test('on a phone, the public pages have no sideways scroll', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 700 } })
    const visitor = await context.newPage()
    for (const path of ['/', '/committees', '/hearings', '/legislators', '/legislators/list']) {
      await visitor.goto(path)
      await expect(visitor.locator('h1').first()).toBeVisible()
      const overflow = await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${path} is wider than the screen`).toBeLessThanOrEqual(0)
    }
    await context.close()
  })
})

test.describe('public home page', () => {
  test('a visitor who opens the site sees the home page, not the login page', async ({ page, browser, playwright }) => {
    const room = `Room E2E ${uniqueSuffix()}`
    const res = await page.request.post(`${API_BASE}/api/__test__/committee-meeting`, { data: { daysFromNow: 1, location: room } })
    expect(res.ok()).toBeTruthy()
    // The home page shows the first five hearings of the public schedule.
    const api = await playwright.request.newContext()
    const schedule = (await (await api.get(`${API_BASE}/api/public/hearings/schedule`)).json()) as {
      committeeId: string
      committee: string
    }[]
    await api.dispose()

    const visitor = await visitorPage(browser)
    await visitor.page.goto('/')
    await expect(visitor.page).toHaveURL(/\/$/)
    await expect(visitor.page.getByRole('heading', { name: 'Follow the Montana Legislature', level: 1 })).toBeVisible()
    // The lead tells the visitor what they can see now, and what an account adds.
    // It does not promise a bill list, because a visitor cannot browse the bills.
    const hero = visitor.page.getByRole('main').locator('section').first()
    await expect(hero).toContainText('You do not need an account.')
    await expect(hero).toContainText('With a free account, your team can track bills')
    await expect(hero).not.toContainText('shows the bills')

    const browse = visitor.page.getByRole('region', { name: 'Browse' })
    await expect(browse.getByRole('link', { name: /^Legislators/ })).toHaveAttribute('href', '/legislators')
    await expect(browse.getByRole('link', { name: /^Committees/ })).toHaveAttribute('href', '/committees')
    await expect(browse.getByRole('link', { name: /^Hearings/ })).toHaveAttribute('href', '/hearings')

    const hearings = visitor.page.getByRole('region', { name: 'Upcoming hearings' })
    const rows = hearings.locator('a[href^="/committees/"]')
    await expect(rows).toHaveCount(Math.min(schedule.length, 5))
    await expect(rows.first()).toHaveAttribute('href', `/committees/${schedule[0].committeeId}`)
    await expect(rows.first()).toContainText(schedule[0].committee)

    await hearings.getByRole('link', { name: 'See all hearings →' }).click()
    await expect(visitor.page).toHaveURL(/\/hearings$/)
    await visitor.page.getByRole('link', { name: 'Rotunda Board home' }).click()
    await expect(visitor.page).toHaveURL(/\/$/)
    await visitor.context.close()
  })

  test('a visitor who signs up from the home page lands on the dashboard', async ({ browser }) => {
    const visitor = await visitorPage(browser)
    await visitor.page.goto('/')
    await visitor.page.getByRole('main').getByRole('link', { name: 'Sign up free' }).click()
    await expect(visitor.page).toHaveURL(/\/signup/)
    const suffix = uniqueSuffix()
    const workspaceName = `E2E Workspace ${suffix}`
    await visitor.page.fill('#workspaceName', workspaceName)
    await visitor.page.fill('#name', 'E2E Visitor')
    await visitor.page.fill('#email', `e2e-visitor-${suffix}@example.dev`)
    await visitor.page.fill('#password', 'e2e-test-password-1')
    await visitor.page.click('button[type="submit"]')
    await expect(visitor.page).toHaveURL(/\/$/)
    await expect(visitor.page.getByText(workspaceName).first()).toBeVisible()
    await expect(visitor.page.getByRole('heading', { name: 'Follow the Montana Legislature' })).toHaveCount(0)
    await visitor.context.close()
  })

  test('a page that needs an account still goes to the login page', async ({ browser }) => {
    const visitor = await visitorPage(browser)
    await visitor.page.goto('/tracking-board')
    await expect(visitor.page).toHaveURL(/\/login/)
    await visitor.context.close()
  })
})

test.describe('public bill API', () => {
  test('the public API shows no workspace data', async ({ page, playwright }) => {
    await signUpFreshWorkspace(page)
    const [bill] = await sessionBills(page)
    expect((await page.request.post(`${API_BASE}/api/bills/${bill.id}/track`)).ok()).toBeTruthy()
    expect((await page.request.patch(`${API_BASE}/api/bills/${bill.id}/position`, { data: { position: 'support' } })).ok()).toBeTruthy()

    // A request with no session cookie.
    const anonymous = await playwright.request.newContext()
    const res = await anonymous.get(`${API_BASE}/api/public/bills/${bill.id}`)
    expect(res.ok()).toBeTruthy()
    const detail = await res.json()
    expect(detail.isTracked).toBe(false)
    expect(detail.position).toBeNull()
    expect(detail.assigneeId).toBeNull()
    expect((await anonymous.get(`${API_BASE}/api/bills/${bill.id}`)).status()).toBe(401)
    await anonymous.dispose()
  })

  test('the public API refuses a client that sends too many requests', async ({ playwright }) => {
    // Its own client address, so that the other public specs keep their limit.
    const client = await playwright.request.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 250) + 1}, 10.0.0.1` },
    })
    let status = 0
    for (let i = 0; i < 125 && status !== 429; i++) {
      status = (await client.get(`${API_BASE}/api/public/bills/not-a-number`)).status()
    }
    expect(status).toBe(429)
    await client.dispose()
  })
})
