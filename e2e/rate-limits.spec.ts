import type { APIRequestContext, Playwright } from '@playwright/test'
import { test, expect, uniqueSuffix } from './fixtures'

// Request limits (server/src/api/rateLimit.ts). The e2e API has no client
// limits for the loopback address (playwright.config.ts). So a test that
// checks a client limit sends the headers of the web service proxy, with its
// own client address.
const API_BASE = 'http://localhost:4000'
const PROXY_SECRET = 'e2e-proxy-secret'

// An address from the documentation range (RFC 5737), different in each test.
function uniqueAddress(): string {
  const n = Math.floor(Math.random() * 65_000)
  return `198.51.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

function proxyClient(playwright: Playwright, address: string, extraHeaders: Record<string, string> = {}) {
  return playwright.request.newContext({
    extraHTTPHeaders: { 'X-Rotunda-Proxy-Secret': PROXY_SECRET, 'X-Rotunda-Client-Ip': address, ...extraHeaders },
  })
}

async function signUpAccount(request: APIRequestContext) {
  const suffix = uniqueSuffix()
  const account = { email: `e2e-${suffix}@example.dev`, password: 'e2e-test-password-1' }
  const res = await request.post(`${API_BASE}/api/auth/signup`, {
    data: { ...account, name: 'E2E Tester', workspaceName: `E2E Workspace ${suffix}` },
  })
  expect(res.status()).toBe(201)
  return account
}

test.describe('request limits', () => {
  test('after 10 failed logins for one email, the login form shows a wait message', async ({ page, playwright }) => {
    const signup = await playwright.request.newContext()
    const account = await signUpAccount(signup)
    await signup.dispose()

    await page.goto('/login')
    await page.fill('#email', account.email)
    const submit = async (password: string) => {
      await page.fill('#password', password)
      const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'))
      await page.click('button[type="submit"]')
      return (await response).status()
    }

    for (let i = 0; i < 10; i++) expect(await submit('wrong-password-1')).toBe(401)
    await expect(page.getByRole('alert')).toHaveText('invalid email or password')

    expect(await submit('wrong-password-1')).toBe(429)
    await expect(page.getByRole('alert')).toHaveText(/^Too many attempts\. Try again in 1[45] minutes\.$/)

    // At the limit, the correct password also gets the wait message.
    expect(await submit(account.password)).toBe(429)
    await expect(page.getByRole('alert')).toContainText('Too many attempts')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('the forgot-password form sends a maximum of 3 emails an hour for one email', async ({ page, request, playwright }) => {
    const signup = await playwright.request.newContext()
    const account = await signUpAccount(signup)
    await signup.dispose()

    const lastSentAt = async () => {
      const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(account.email)}`)
      return res.ok() ? ((await res.json()) as { sentAt: number }).sentAt : null
    }
    const submit = async () => {
      await page.goto('/forgot-password')
      await page.fill('#email', account.email)
      await page.click('button[type="submit"]')
    }

    for (let i = 0; i < 3; i++) {
      await submit()
      await expect(page.getByText('If an account exists for that email, a reset link is on its way.')).toBeVisible()
    }
    const sentAt = await lastSentAt()
    expect(sentAt).not.toBeNull()

    await submit()
    await expect(page.getByRole('alert')).toHaveText(/^Too many attempts\. Try again in (59|60) minutes\.$/)
    // The fourth request sent no email.
    expect(await lastSentAt()).toBe(sentAt)
  })

  test('a client gets 429 after 20 forgot-password requests in one hour', async ({ playwright }) => {
    const client = await proxyClient(playwright, uniqueAddress())
    const forgot = (c: APIRequestContext) =>
      c.post(`${API_BASE}/api/auth/forgot-password`, { data: { email: `e2e-nobody-${uniqueSuffix()}@example.dev` } })

    for (let i = 0; i < 20; i++) expect((await forgot(client)).status()).toBe(200)
    const limited = await forgot(client)
    expect(limited.status()).toBe(429)
    expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(3500)

    // The limit is for one client address only.
    const other = await proxyClient(playwright, uniqueAddress())
    expect((await forgot(other)).status()).toBe(200)
    await client.dispose()
    await other.dispose()
  })

  test('a false X-Forwarded-For address does not use up the limit of that address', async ({ playwright }) => {
    const victimAddress = uniqueAddress()
    // The attacker sends the address of the victim in X-Forwarded-For and in
    // the proxy header, but does not know the proxy secret.
    const attacker = await playwright.request.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-For': `${victimAddress}, 10.0.0.1`,
        'X-Rotunda-Proxy-Secret': 'not-the-secret',
        'X-Rotunda-Client-Ip': victimAddress,
      },
    })
    for (let i = 0; i < 125; i++) await attacker.get(`${API_BASE}/api/public/bills/not-a-number`)

    const victim = await proxyClient(playwright, victimAddress, { 'X-Forwarded-For': `${victimAddress}, 10.0.0.1` })
    expect((await victim.get(`${API_BASE}/api/public/bills/not-a-number`)).status()).toBe(400)
    await attacker.dispose()
    await victim.dispose()
  })
})
