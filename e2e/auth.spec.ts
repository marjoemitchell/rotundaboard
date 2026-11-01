import { test, expect, signUpFreshWorkspace, login, logout, uniqueSuffix } from './fixtures'

test.describe('auth', () => {
  test('signup creates a workspace and lands on the dashboard', async ({ page }) => {
    const info = await signUpFreshWorkspace(page)
    await expect(page.locator('text=' + info.workspaceName)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('rejects a duplicate email on signup', async ({ page }) => {
    const info = await signUpFreshWorkspace(page)
    await logout(page)
    await page.goto('/signup')
    await page.fill('#workspaceName', `E2E Workspace ${uniqueSuffix()}`)
    await page.fill('#name', 'Someone Else')
    await page.fill('#email', info.email)
    await page.fill('#password', 'another-password-1')
    await page.click('button[type="submit"]')
    await expect(page.locator('text=an account with this email already exists')).toBeVisible()
  })

  const SAME_INBOX = 'goes to the same inbox as the address without them'

  // Fills the signup form for another workspace and submits it.
  async function submitSignup(page: import('@playwright/test').Page, email: string) {
    await page.goto('/signup')
    await page.fill('#workspaceName', `E2E Workspace ${uniqueSuffix()}`)
    await page.fill('#name', 'Someone Else')
    await page.fill('#email', email)
    await page.fill('#password', 'another-password-1')
    await page.click('button[type="submit"]')
  }

  test('rejects a "+" address of an email that already has an account', async ({ page }) => {
    const suffix = uniqueSuffix()
    await signUpFreshWorkspace(page, { email: `e2e-${suffix}@example.dev` })
    await logout(page)

    await submitSignup(page, `e2e-${suffix}+newaccount@example.dev`)
    await expect(page.getByText(SAME_INBOX)).toBeVisible()
    await expect(page).toHaveURL(/\/signup/)
  })

  test('rejects the plain address when a "+" address of it already has an account', async ({ page }) => {
    const suffix = uniqueSuffix()
    // An address with "+" can make an account when no account uses its inbox.
    await signUpFreshWorkspace(page, { email: `e2e-${suffix}+first@example.dev` })
    await logout(page)

    await submitSignup(page, `E2E-${suffix}@Example.dev`)
    await expect(page.getByText(SAME_INBOX)).toBeVisible()
    await submitSignup(page, `e2e-${suffix}+second@example.dev`)
    await expect(page.getByText(SAME_INBOX)).toBeVisible()
  })

  test('rejects a Gmail address that differs only in dots, "+", or googlemail.com', async ({ page }) => {
    // "e2e-inbox" Gmail addresses are test users too (server/src/e2eCleanup.ts).
    const n = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`
    await signUpFreshWorkspace(page, { email: `e2e-inbox${n}@gmail.com` })
    await logout(page)

    for (const email of [`e2e-inbox.${n}@gmail.com`, `e2e-inbox${n}@googlemail.com`, `E2E-Inbox.${n}+work@GoogleMail.com`]) {
      await submitSignup(page, email)
      await expect(page.getByText(SAME_INBOX), email).toBeVisible()
      await expect(page).toHaveURL(/\/signup/)
    }
  })

  test('two signups for one inbox at the same time make only one account', async ({ page, playwright }) => {
    const suffix = uniqueSuffix()
    // Two clients with no session, so that each signup is a new visitor.
    const clients = await Promise.all([playwright.request.newContext(), playwright.request.newContext()])
    const responses = await Promise.all(
      [`e2e-${suffix}+one@example.dev`, `e2e-${suffix}+two@example.dev`].map((email, i) =>
        clients[i].post('http://localhost:4000/api/auth/signup', {
          data: { email, password: 'e2e-test-password-1', name: 'E2E Tester', workspaceName: `E2E Workspace ${suffix}-${i}` },
        }),
      ),
    )
    const statuses = responses.map((r) => r.status()).sort()
    expect(statuses).toEqual([201, 409])
    const refused = responses.find((r) => r.status() === 409)!
    expect((await refused.json()).error).toContain('goes to the same inbox')
    await Promise.all(clients.map((c) => c.dispose()))

    // The refused signup made no workspace and no account: the plain address cannot sign up either.
    await submitSignup(page, `e2e-${suffix}@example.dev`)
    await expect(page.getByText(SAME_INBOX)).toBeVisible()
  })

  test('dots still make a different address outside Gmail', async ({ page }) => {
    const suffix = uniqueSuffix()
    await signUpFreshWorkspace(page, { email: `e2e-${suffix}@example.dev` })
    await logout(page)

    await submitSignup(page, `e2e-.${suffix}@example.dev`)
    await page.waitForURL('/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('logout then login with the same credentials works', async ({ page }) => {
    const info = await signUpFreshWorkspace(page)
    await logout(page)
    await login(page, info.email, info.password)
    await expect(page.locator('text=' + info.workspaceName)).toBeVisible()
  })

  test('rejects an invalid password on login', async ({ page }) => {
    const info = await signUpFreshWorkspace(page)
    await logout(page)
    await page.goto('/login')
    await page.fill('input[type="email"]', info.email)
    await page.fill('input[type="password"]', 'totally-wrong-password')
    await page.click('button[type="submit"]')
    await expect(page.locator('text=Could not sign in').or(page.locator('text=invalid email or password'))).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('visiting a protected route while signed out redirects to login', async ({ page }) => {
    await page.goto('/tracking-board')
    await expect(page).toHaveURL(/\/login/)
  })

  test('logging out from a protected page then logging in as someone else lands on the dashboard, not that page', async ({
    page,
  }) => {
    // Regression test: RequireAuth redirects an unauthenticated visitor to
    // /login with state.from set to whatever page they were on, so LoginPage
    // can return them there after signing in. Logging out while on a
    // protected page triggers that same redirect (session drops to null
    // while still rendering that route) — without AuthContext.logout()
    // navigating explicitly, the next person to log in on that same /login
    // page inherited the previous user's state.from and landed on their page
    // (e.g. Settings) instead of the dashboard.
    const userA = await signUpFreshWorkspace(page)
    await logout(page)
    const userB = await signUpFreshWorkspace(page)
    await logout(page)

    await login(page, userA.email, userA.password)
    await page.goto('/settings')
    await expect(page.locator('h1', { hasText: 'Settings' })).toBeVisible()
    await logout(page)

    await login(page, userB.email, userB.password)
    await expect(page).toHaveURL('/')
    await expect(page.locator('text=' + userB.workspaceName)).toBeVisible()
  })

  test('forgot-password always shows the generic confirmation, even for an unknown email', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.fill('input[type="email"]', `nobody-${uniqueSuffix()}@example.dev`)
    await page.click('button[type="submit"]')
    await expect(page.locator('text=If an account exists for that email')).toBeVisible()
  })

  test('reset-password page without a token shows an error instead of a form', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.locator('text=This link is missing its reset token')).toBeVisible()
  })
})
