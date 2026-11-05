import type { Page } from '@playwright/test'
import { test, expect, signUpThroughApi, findSessionIdWithBills, getLastEmail, logout } from './fixtures'

// Cross-site request forgery (server/src/api/originCheck.ts).
//
// The attack page is on http://localhost:5999. This origin is different from
// the web app, but it is the same site as the API (localhost). So the browser
// sends the local session cookie (SameSite=Lax) with the form POST. In
// production the cookie has SameSite=None, and the browser sends it from all sites.
const API_BASE = 'http://localhost:4000'
const ATTACK_ORIGIN = 'http://localhost:5999'

async function firstBillId(page: Page): Promise<string> {
  // findSessionIdWithBills runs fetch in the page, so open the app first.
  await page.goto('/')
  const sessionId = await findSessionIdWithBills(page)
  const res = await page.request.get(`${API_BASE}/api/sessions/${sessionId}/bills`)
  const bills = (await res.json()) as { id: string }[]
  return bills[0].id
}

// Opens a page on the attack origin. The page submits a form to the API.
// Returns the status of the API response.
async function submitFormFromAttackPage(page: Page, apiPath: string): Promise<number> {
  await page.route(`${ATTACK_ORIGIN}/attack`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<form id="f" method="POST" action="${API_BASE}${apiPath}"></form>
             <script>document.getElementById('f').submit()</script>`,
    }),
  )
  const response = page.waitForResponse((r) => r.url() === `${API_BASE}${apiPath}` && r.request().method() === 'POST')
  await page.goto(`${ATTACK_ORIGIN}/attack`)
  return (await response).status()
}

test.describe('requests from other sites', () => {
  test('a form on another site cannot track a bill for the signed-in user', async ({ page }) => {
    await signUpThroughApi(page)
    const billId = await firstBillId(page)

    expect(await submitFormFromAttackPage(page, `/api/bills/${billId}/track`)).toBe(403)

    await page.goto(`/bills/${billId}`)
    await expect(page.getByRole('button', { name: '+ Track this bill' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop tracking' })).toHaveCount(0)
  })

  test('a form on another site cannot sign the user out', async ({ page }) => {
    const account = await signUpThroughApi(page)

    expect(await submitFormFromAttackPage(page, '/api/auth/logout')).toBe(403)

    await page.goto('/')
    await expect(page.getByText(account.workspaceName).first()).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('a form on another site cannot send the brief email', async ({ page, request }) => {
    const account = await signUpThroughApi(page)

    expect(await submitFormFromAttackPage(page, '/api/brief/send')).toBe(403)

    const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(account.email)}`)
    expect(res.status()).toBe(404)
  })

  test('the API refuses a request with the Origin of another site', async ({ page }) => {
    await signUpThroughApi(page)
    const billId = await firstBillId(page)

    const refused = await page.request.post(`${API_BASE}/api/bills/${billId}/track`, {
      headers: { Origin: 'https://attacker.example' },
    })
    expect(refused.status()).toBe(403)
    const refusedByReferer = await page.request.post(`${API_BASE}/api/bills/${billId}/track`, {
      headers: { Referer: 'https://attacker.example/page' },
    })
    expect(refusedByReferer.status()).toBe(403)

    const accepted = await page.request.post(`${API_BASE}/api/bills/${billId}/track`, {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(accepted.status()).toBe(201)
  })

  test('tracking a bill, sending the brief, and signing out still work in the app', async ({ page }) => {
    const account = await signUpThroughApi(page)
    const billId = await firstBillId(page)

    await page.goto(`/bills/${billId}`)
    await page.getByRole('button', { name: '+ Track this bill' }).click()
    await expect(page.getByRole('button', { name: 'Stop tracking' })).toBeVisible()

    await page.goto('/')
    await page.getByRole('button', { name: 'Send this brief →' }).click()
    await expect(page.getByRole('button', { name: 'Send this brief →' })).toBeEnabled()
    expect((await getLastEmail(page.request, account.email)).subject).toContain('Morning brief')

    await logout(page)
    await expect(page).toHaveURL(/\/login/)
  })
})
