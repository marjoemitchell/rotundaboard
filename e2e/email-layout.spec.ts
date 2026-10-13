import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill, uniqueSuffix } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// This file runs alert jobs, which process all pending changes, so run its
// tests in order. See change-alerts.spec.ts for the same reason.
test.describe.configure({ mode: 'serial' })

type CapturedEmail = { subject: string; html: string; text: string | null }

async function lastEmail(request: APIRequestContext, to: string): Promise<CapturedEmail> {
  const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(to)}`)
  expect(res.ok(), `an email to ${to}`).toBeTruthy()
  return res.json()
}

// Every email uses the shared layout (server/src/emailLayout.ts): the
// Rotunda Board header, the heading, and a plain-text version.
function expectLayout(email: CapturedEmail, heading: string | RegExp) {
  expect(email.html).toContain('data-layout="rotunda-board"')
  expect(email.html).toContain('icon-512-dark.png')
  expect(email.html).toMatch(typeof heading === 'string' ? new RegExp(`<h1[^>]*>${heading}</h1>`) : heading)
  expect(email.text).toBeTruthy()
  expect(email.text).toMatch(/^Rotunda Board\n/)
}

test.describe('email layout', () => {
  test('the invitation email has the layout, an accept button, and an escaped workspace name', async ({ page }) => {
    // HTML in a workspace name must show as text in the email.
    const workspaceName = `E2E <i>Esc</i> ${uniqueSuffix()}`
    await signUpFreshWorkspace(page, { workspaceName })
    const me = await (await page.request.get(`${API_BASE}/api/auth/me`)).json()
    const invitee = `e2e-layout-${uniqueSuffix()}@example.dev`
    const res = await page.request.post(`${API_BASE}/api/workspaces/${me.currentWorkspace.id}/invites`, {
      data: { email: invitee, role: 'member' },
    })
    expect(res.ok()).toBeTruthy()

    const email = await lastEmail(page.request, invitee)
    expectLayout(email, /<h1[^>]*>Join E2E &lt;i&gt;Esc&lt;\/i&gt; .* on Rotunda Board<\/h1>/)
    expect(email.html).not.toContain('<i>Esc</i>')
    expect(email.html).toMatch(/<a href="[^"]*\/accept-invite\?token=[^"]+"[^>]*>Accept the invitation<\/a>/)
    expect(email.text).toMatch(/Accept the invitation: http\S*\/accept-invite\?token=\S+/)
  })

  test('the password reset email has the layout and a reset button', async ({ page, request }) => {
    const user = await signUpFreshWorkspace(page)
    const res = await request.post(`${API_BASE}/api/auth/forgot-password`, { data: { email: user.email } })
    expect(res.ok()).toBeTruthy()

    const email = await lastEmail(request, user.email)
    expectLayout(email, 'Reset your password')
    expect(email.html).toMatch(/<a href="[^"]*\/reset-password\?token=[^"]+"[^>]*>Set a new password<\/a>/)
    expect(email.text).toContain('If you did not ask to reset your password')
  })

  test('the morning brief email has the layout and a dashboard button', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    await page.goto('/')
    await page.click('button:has-text("Send this brief")')
    await expect(page.locator('text=Brief sent to your email.')).toBeVisible()

    const email = await lastEmail(page.request, user.email)
    expect(email.subject).toBe(`Morning brief: ${user.workspaceName}`)
    expectLayout(email, `Morning brief: ${user.workspaceName}`)
    expect(email.html).toContain('>Open the dashboard</a>')
  })

  test('a change alert email has the layout and a link to the alert settings', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackFirstAvailableBill(page)
    // The first alert run in an empty database only records a baseline.
    await page.request.post(`${API_BASE}/api/__test__/alerts/run`, { data: {} })
    await page.request.post(`${API_BASE}/api/__test__/status-change`, { data: { billId } })
    await page.request.post(`${API_BASE}/api/__test__/alerts/run`, { data: {} })

    const email = await lastEmail(page.request, user.email)
    expectLayout(email, '1 update for you')
    expect(email.html).toContain(`/bills/${billId}`)
    expect(email.html).toMatch(/<a href="[^"]*\/settings"[^>]*>Change alert settings<\/a>/)
    expect(email.text).toContain(identifier)
  })

  test('a scrape health alert email has the layout', async ({ request }) => {
    const job = `e2e-scrape-${uniqueSuffix()}`
    const maintainer = `e2e-maintainer-${uniqueSuffix()}@example.dev`
    const res = await request.post(`${API_BASE}/api/__test__/scrape-health/simulate`, {
      data: { job, alertTo: maintainer, responses: [{ endpoint: 'bills', items: [] }] },
    })
    expect(res.ok()).toBeTruthy()

    const email = await lastEmail(request, maintainer)
    expectLayout(email, `Problem: the &quot;${job}&quot; scrape`)
    expect(email.text).toContain('The API returned no items')
  })
})
