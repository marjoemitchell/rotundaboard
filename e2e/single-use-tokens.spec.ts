import type { APIRequestContext, Playwright } from '@playwright/test'
import { test, expect, signUpThroughApi, getLastEmailToken, uniqueSuffix } from './fixtures'

// Issue #60: an invite token and a password reset token work one time only,
// also when two requests use the same token at the same time.

const API = 'http://localhost:4000'
const PASSWORD = 'e2e-test-password-1'

// Two clients with no session, so that each request is a new visitor.
async function twoClients(playwright: Playwright): Promise<APIRequestContext[]> {
  return Promise.all([playwright.request.newContext(), playwright.request.newContext()])
}

async function currentWorkspaceId(request: APIRequestContext): Promise<number> {
  const me = await (await request.get(`${API}/api/auth/me`)).json()
  return me.currentWorkspace.id as number
}

// Sends an invite from the workspace of `admin` and returns the token from the email.
async function invite(admin: APIRequestContext, workspaceId: number, email: string): Promise<string> {
  const res = await admin.post(`${API}/api/workspaces/${workspaceId}/invites`, { data: { email, role: 'member' } })
  expect(res.status(), await res.text()).toBe(201)
  return getLastEmailToken(admin, email)
}

async function memberCount(admin: APIRequestContext, workspaceId: number): Promise<number> {
  const res = await admin.get(`${API}/api/workspaces/${workspaceId}/members`)
  expect(res.ok(), await res.text()).toBeTruthy()
  return ((await res.json()) as unknown[]).length
}

async function signupWithInvite(client: APIRequestContext, email: string, inviteToken: string) {
  return client.post(`${API}/api/auth/signup`, {
    data: { email, password: PASSWORD, name: 'E2E Invited Member', inviteToken },
  })
}

async function requestResetToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API}/api/auth/forgot-password`, { data: { email } })
  expect(res.ok()).toBeTruthy()
  return getLastEmailToken(request, email)
}

test.describe('single-use tokens', () => {
  test('two signups with one invite token at the same time make one member', async ({ page, playwright }) => {
    await signUpThroughApi(page)
    const workspaceId = await currentWorkspaceId(page.request)
    const token = await invite(page.request, workspaceId, `e2e-invitee-${uniqueSuffix()}@example.dev`)

    const clients = await twoClients(playwright)
    const responses = await Promise.all(
      clients.map((c, i) => signupWithInvite(c, `e2e-race-${uniqueSuffix()}-${i}@example.dev`, token)),
    )
    expect(responses.map((r) => r.status()).sort()).toEqual([201, 400])
    const refused = responses.find((r) => r.status() === 400)!
    expect((await refused.json()).error).toContain('invalid or has expired')
    await Promise.all(clients.map((c) => c.dispose()))

    // The admin and one new member.
    expect(await memberCount(page.request, workspaceId)).toBe(2)
  })

  test('two signups for the last place of the plan at the same time make one member', async ({ page, playwright }) => {
    test.setTimeout(90_000)
    // The team plan is for 10 people: the admin, 8 members, and 1 free place.
    await signUpThroughApi(page, 'team')
    const workspaceId = await currentWorkspaceId(page.request)
    const filler = await playwright.request.newContext()
    for (let i = 0; i < 8; i++) {
      const email = `e2e-filler-${uniqueSuffix()}-${i}@example.dev`
      const token = await invite(page.request, workspaceId, email)
      const res = await signupWithInvite(filler, email, token)
      expect(res.status(), await res.text()).toBe(201)
      await filler.post(`${API}/api/auth/logout`)
    }
    await filler.dispose()
    expect(await memberCount(page.request, workspaceId)).toBe(9)

    // Two invites were sent when the plan had no limit, so both are open now.
    await page.request.post(`${API}/api/__test__/workspace-plan`, { data: { plan: 'organization' } })
    const emails = [0, 1].map((i) => `e2e-last-${uniqueSuffix()}-${i}@example.dev`)
    const tokens = [await invite(page.request, workspaceId, emails[0]), await invite(page.request, workspaceId, emails[1])]
    await page.request.post(`${API}/api/__test__/workspace-plan`, { data: { plan: 'team' } })

    const clients = await twoClients(playwright)
    const responses = await Promise.all(clients.map((c, i) => signupWithInvite(c, emails[i], tokens[i])))
    expect(responses.map((r) => r.status()).sort()).toEqual([201, 402])
    await Promise.all(clients.map((c) => c.dispose()))

    expect(await memberCount(page.request, workspaceId)).toBe(10)
  })

  test('one user who accepts one invite in two sessions at the same time gets one success', async ({
    page,
    playwright,
  }) => {
    await signUpThroughApi(page)
    const workspaceId = await currentWorkspaceId(page.request)

    // The invited person has an account in another workspace and two sessions.
    const sessions = await twoClients(playwright)
    const email = `e2e-existing-${uniqueSuffix()}@example.dev`
    const signup = await sessions[0].post(`${API}/api/auth/signup`, {
      data: { email, password: PASSWORD, name: 'E2E Existing User', workspaceName: `E2E Workspace ${uniqueSuffix()}` },
    })
    expect(signup.status()).toBe(201)
    const login = await sessions[1].post(`${API}/api/auth/login`, { data: { email, password: PASSWORD } })
    expect(login.ok()).toBeTruthy()

    const token = await invite(page.request, workspaceId, email)
    const responses = await Promise.all(sessions.map((s) => s.post(`${API}/api/invites/${token}/accept`)))
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 400])
    await Promise.all(sessions.map((s) => s.dispose()))

    expect(await memberCount(page.request, workspaceId)).toBe(2)
  })

  test('two password resets with one token at the same time change the password one time', async ({
    page,
    playwright,
  }) => {
    const account = await signUpThroughApi(page)
    const token = await requestResetToken(page.request, account.email)

    const clients = await twoClients(playwright)
    const responses = await Promise.all(
      ['e2e-new-password-1', 'e2e-new-password-2'].map((newPassword, i) =>
        clients[i].post(`${API}/api/auth/reset-password`, { data: { token, newPassword } }),
      ),
    )
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 400])
    const refused = responses.find((r) => r.status() === 400)!
    expect((await refused.json()).error).toContain('invalid or has expired')
    await Promise.all(clients.map((c) => c.dispose()))
  })

  test('after a password reset, an older reset link shows that it is invalid', async ({ page }) => {
    const account = await signUpThroughApi(page)
    const olderToken = await requestResetToken(page.request, account.email)
    const newerToken = await requestResetToken(page.request, account.email)

    await page.goto(`/reset-password?token=${newerToken}`)
    await page.fill('#password', 'e2e-new-password-1')
    await page.click('button[type="submit"]')
    await page.waitForURL('/login')

    await page.goto(`/reset-password?token=${olderToken}`)
    await page.fill('#password', 'e2e-new-password-2')
    await page.click('button[type="submit"]')
    await expect(page.getByText('this reset link is invalid or has expired')).toBeVisible()
    await expect(page).toHaveURL(/\/reset-password/)
  })
})
