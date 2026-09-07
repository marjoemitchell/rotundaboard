import {
  test,
  expect,
  signUpFreshWorkspace,
  login,
  logout,
  trackFirstAvailableBill,
  getLastEmailToken,
  pendingInviteRow,
  uniqueSuffix,
} from './fixtures'

test.describe('workspace isolation', () => {
  test('a fresh workspace cannot see another workspace\'s tracked bills', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)
    await page.goto('/tracking-board')
    await expect(page.locator('.skeleton').first()).toHaveCount(0)
    await expect(page.locator('text=No bills are being tracked yet')).not.toBeVisible()

    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await signUpFreshWorkspace(otherPage)
    await otherPage.goto('/tracking-board')
    await expect(otherPage.locator('text=No bills are being tracked yet')).toBeVisible()
    await otherContext.close()
  })
})

test.describe('invites', () => {
  test('a member sees no invite controls in Settings (admin-gated client and server side)', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const inviteEmail = `e2e-member-${uniqueSuffix()}@example.dev`
    await page.goto('/settings')
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', inviteEmail)
    await page.click('button:has-text("Send invite")')
    await expect(pendingInviteRow(page, inviteEmail)).toBeVisible()

    const token = await getLastEmailToken(page.request, inviteEmail)
    const memberCtx = await browser.newContext()
    const memberPage = await memberCtx.newPage()
    await memberPage.goto(`/accept-invite?token=${token}`)
    await memberPage.fill('#name', 'E2E Member')
    await memberPage.fill('#password', 'e2e-member-password-1')
    await memberPage.click('button:has-text("Create account and join")')
    await memberPage.waitForURL('/')

    await memberPage.goto('/settings')
    await expect(memberPage.locator('text=Invite someone')).not.toBeVisible()
    await expect(memberPage.locator('text=Pending invites')).not.toBeVisible()

    // Server-side enforcement, not just a hidden button: a direct request
    // still gets rejected even though the member is authenticated.
    const workspaceId = (await (await memberPage.request.get('http://localhost:4000/api/auth/me')).json())
      .currentWorkspace.id
    const directAttempt = await memberPage.request.post(`http://localhost:4000/api/workspaces/${workspaceId}/invites`, {
      data: { email: `e2e-blocked-${uniqueSuffix()}@example.dev`, role: 'member' },
    })
    expect(directAttempt.status()).toBe(403)

    await memberCtx.close()
  })

  test('accepting as a brand-new account joins the inviting workspace, not a new one', async ({ page, browser }) => {
    const admin = await signUpFreshWorkspace(page)
    const inviteEmail = `e2e-newacct-${uniqueSuffix()}@example.dev`

    await page.goto('/settings')
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', inviteEmail)
    await page.click('button:has-text("Send invite")')
    await expect(pendingInviteRow(page, inviteEmail)).toBeVisible()

    const token = await getLastEmailToken(page.request, inviteEmail)

    const inviteeCtx = await browser.newContext()
    const inviteePage = await inviteeCtx.newPage()
    await inviteePage.goto(`/accept-invite?token=${token}`)
    await expect(inviteePage.locator('h1', { hasText: admin.workspaceName })).toBeVisible()
    await inviteePage.fill('#name', 'E2E New Member')
    await inviteePage.fill('#password', 'e2e-newacct-password-1')
    await inviteePage.click('button:has-text("Create account and join")')
    await inviteePage.waitForURL('/')
    // The signup+accept request chain (bcrypt hash, a transaction, then a
    // client-side refresh) can outlast a bare toBeVisible()'s default
    // timeout before the SPA re-renders past the accept-invite page, so
    // anchor on the Dashboard heading first rather than racing the header.
    await expect(inviteePage.locator('h1', { hasText: 'Dashboard' })).toBeVisible({ timeout: 10000 })
    await expect(inviteePage.locator('nav[aria-label="Primary"]').getByText(admin.workspaceName)).toBeVisible()

    // The invite disappears from the admin's pending list once accepted.
    await page.goto('/settings')
    await expect(pendingInviteRow(page, inviteEmail)).not.toBeVisible()

    await inviteeCtx.close()
  })

  test('accepting as an existing account (different email) is rejected', async ({ page, browser }) => {
    await signUpFreshWorkspace(page)
    const inviteEmail = `e2e-targeted-${uniqueSuffix()}@example.dev`
    await page.goto('/settings')
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', inviteEmail)
    await page.click('button:has-text("Send invite")')
    await expect(pendingInviteRow(page, inviteEmail)).toBeVisible()
    const token = await getLastEmailToken(page.request, inviteEmail)

    // A second, unrelated account tries to accept an invite addressed to
    // someone else's email — should be rejected with a clear message.
    const otherCtx = await browser.newContext()
    const otherPage = await otherCtx.newPage()
    const other = await signUpFreshWorkspace(otherPage)
    await otherPage.goto(`/accept-invite?token=${token}`)
    await expect(otherPage.locator(`text=You're signed in as ${other.email}`)).toBeVisible()
    await otherCtx.close()
  })

  test('an existing account accepting an invite into a second workspace gains a second membership', async ({
    page,
    browser,
  }) => {
    const admin = await signUpFreshWorkspace(page)
    const secondAccount = await (async () => {
      const ctx = await browser.newContext()
      const p = await ctx.newPage()
      const info = await signUpFreshWorkspace(p)
      await ctx.close()
      return info
    })()

    await page.goto('/settings')
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', secondAccount.email)
    await page.click('button:has-text("Send invite")')
    await expect(pendingInviteRow(page, secondAccount.email)).toBeVisible()
    const token = await getLastEmailToken(page.request, secondAccount.email)

    const secondCtx = await browser.newContext()
    const secondPage = await secondCtx.newPage()
    await login(secondPage, secondAccount.email, secondAccount.password)
    await secondPage.goto(`/accept-invite?token=${token}`)
    await expect(secondPage.locator('h1', { hasText: admin.workspaceName })).toBeVisible()
    await secondPage.click('button:has-text("Accept and join")')
    await secondPage.waitForURL('/')
    // Now a member of two workspaces, so the LeftNav account block swaps
    // its single-name label for a workspace switcher — check for that
    // select, not text that now lives inside a closed (and therefore not
    // "visible") <option>.
    await expect(secondPage.locator('select[aria-label="Switch workspace"]')).toBeVisible()

    const me = await (await secondPage.request.get('http://localhost:4000/api/auth/me')).json()
    expect(me.workspaces.length).toBeGreaterThanOrEqual(2)
    expect(me.workspaces.some((w: { name: string }) => w.name === admin.workspaceName)).toBe(true)
    expect(me.workspaces.some((w: { name: string }) => w.name === secondAccount.workspaceName)).toBe(true)

    await secondCtx.close()
  })

  test('revoke invalidates the token and resend issues a working one', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await signUpFreshWorkspace(page)
    const inviteEmail = `e2e-revoke-${uniqueSuffix()}@example.dev`
    await page.goto('/settings')
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', inviteEmail)
    await page.click('button:has-text("Send invite")')
    await expect(pendingInviteRow(page, inviteEmail)).toBeVisible()
    const firstToken = await getLastEmailToken(page.request, inviteEmail)

    await page.click('button:has-text("Revoke")')
    await page.waitForTimeout(300)
    await page.reload()
    await expect(pendingInviteRow(page, inviteEmail)).not.toBeVisible()

    const revokedLookup = await page.request.get(`http://localhost:4000/api/invites/${firstToken}`)
    expect(revokedLookup.status()).toBe(404)

    // Send a fresh invite and confirm resend rotates the token.
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', inviteEmail)
    await page.click('button:has-text("Send invite")')
    await expect(pendingInviteRow(page, inviteEmail)).toBeVisible()
    const secondToken = await getLastEmailToken(page.request, inviteEmail)

    await page.click('button:has-text("Resend")')
    await expect(page.locator('text=Invite re-sent')).toBeVisible()
    const thirdToken = await getLastEmailToken(page.request, inviteEmail)
    expect(thirdToken).not.toBe(secondToken)

    const oldLookup = await page.request.get(`http://localhost:4000/api/invites/${secondToken}`)
    expect(oldLookup.status()).toBe(404)
    const newLookup = await page.request.get(`http://localhost:4000/api/invites/${thirdToken}`)
    expect(newLookup.ok()).toBe(true)
  })
})

test.describe('password reset', () => {
  test('reset link from email logs in and invalidates other sessions', async ({ page, browser }) => {
    const info = await signUpFreshWorkspace(page)

    // A second, still-logged-in session for the same account — the reset
    // should sign this one out too.
    const otherCtx = await browser.newContext()
    const otherPage = await otherCtx.newPage()
    await login(otherPage, info.email, info.password)
    await expect(otherPage.locator(`text=${info.workspaceName}`)).toBeVisible()

    await logout(page)
    await page.goto('/forgot-password')
    await page.fill('input[type="email"]', info.email)
    await page.click('button[type="submit"]')
    await expect(page.locator('text=If an account exists for that email')).toBeVisible()

    const token = await getLastEmailToken(page.request, info.email)
    await page.goto(`/reset-password?token=${token}`)
    await page.fill('#password', 'e2e-reset-new-password-1')
    await page.click('button[type="submit"]')
    await page.waitForURL('/')
    await expect(page.locator(`text=${info.workspaceName}`)).toBeVisible()

    // Old password no longer works; new one does.
    await logout(page)
    await page.goto('/login')
    await page.fill('input[type="email"]', info.email)
    await page.fill('input[type="password"]', info.password)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/login/)
    await page.fill('input[type="password"]', 'e2e-reset-new-password-1')
    await page.click('button[type="submit"]')
    await page.waitForURL('/')

    // The other, previously-logged-in session was force-logged-out by the reset.
    await otherPage.reload()
    await expect(otherPage).toHaveURL(/\/login/)

    await otherCtx.close()
  })
})
