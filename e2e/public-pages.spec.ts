import type { Browser, Page } from '@playwright/test'
import { test, expect, findSessionIdWithBills, signUpFreshWorkspace, uniqueSuffix } from './fixtures'

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
    await visitor.page.goto('/bills/1/compare')
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
