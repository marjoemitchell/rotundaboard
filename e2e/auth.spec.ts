import { test, expect, signUpFreshWorkspace, login, logout, uniqueSuffix } from './fixtures'

test.describe('auth', () => {
  test('signup creates a workspace and lands on the dashboard', async ({ page }) => {
    const info = await signUpFreshWorkspace(page)
    await expect(page.locator('text=' + info.workspaceName)).toBeVisible()
    await expect(page.locator('text=Dashboard')).toBeVisible()
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
