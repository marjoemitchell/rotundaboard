import type { Page } from '@playwright/test'
import {
  test,
  expect,
  createHearingFixture,
  findSessionIdWithBills,
  getLastEmailToken,
  pendingInviteRow,
  setWorkspacePlan,
  signUpFreshWorkspace,
  trackFirstAvailableBill,
  uniqueSuffix,
} from './fixtures'

const API_BASE = 'http://localhost:4000'

// Each test here signs up, changes the plan, and loads the large dashboard
// again. Run the tests one at a time, so that they do not use the browser
// resources of the multi-user specs that run at the same time.
test.describe.configure({ mode: 'serial' })

async function sessionBills(page: Page): Promise<{ id: string; identifier: string }[]> {
  const sessionId = await findSessionIdWithBills(page)
  const res = await page.request.get(`${API_BASE}/api/sessions/${sessionId}/bills`)
  return res.json()
}

test.describe('plans page', () => {
  test('a new workspace has the free plan, and the plans page shows each plan', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })

    await page.getByRole('link', { name: 'Free plan' }).click()
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible()
    await expect(page.getByTestId('plan-usage')).toHaveText('Your workspace has the Free plan: 0 of 10 tracked bills · 1 of 1 members')

    const free = page.getByRole('region', { name: 'Free plan' })
    await expect(free.getByText('Your plan')).toBeVisible()
    await expect(free).toContainText('Track up to 10 bills')

    const single = page.getByRole('region', { name: 'Single user plan' })
    await expect(single).toContainText('$349 a year')
    await expect(single).toContainText('or $39 a month, or $249 for a session pass')
    await expect(page.getByRole('region', { name: 'Team plan' })).toContainText('Up to 10 members')
    await expect(page.getByRole('region', { name: 'Organization plan' })).toContainText('Unlimited members')
  })

  test('a change of plan shows in the navigation and on the plans page', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'team' })
    await expect(page.getByRole('link', { name: 'Team plan' })).toBeVisible()
    await page.goto('/plans')
    await expect(page.getByRole('region', { name: 'Team plan' }).getByText('Your plan')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Free plan' }).getByText('Your plan')).toHaveCount(0)
  })
})

test.describe('free plan limits', () => {
  // Tracks 10 bills through the API, the limit of the free plan.
  async function trackTen(page: Page) {
    const bills = await sessionBills(page)
    for (const bill of bills.slice(0, 10)) {
      const res = await page.request.post(`${API_BASE}/api/bills/${bill.id}/track`)
      expect(res.ok()).toBeTruthy()
    }
    return bills[10]
  }

  test('a free workspace can track 10 bills, and the 11th shows the limit', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })
    const eleventh = await trackTen(page)

    await page.goto(`/bills/${eleventh.id}`)
    await page.getByRole('button', { name: '+ Track this bill' }).click()
    await expect(page.getByText('The Free plan can track 10 bills. See the plans on the Plans page.')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Track this bill' })).toBeVisible()

    await page.goto('/plans')
    await expect(page.getByTestId('plan-usage')).toContainText('10 of 10 tracked bills')
  })

  test('after an upgrade, the workspace can track more than 10 bills', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })
    const eleventh = await trackTen(page)
    await setWorkspacePlan(page, 'single_user', { path: `/bills/${eleventh.id}` })
    await page.getByRole('button', { name: '+ Track this bill' }).click()
    await expect(page.getByRole('button', { name: 'Stop tracking' })).toBeVisible()
  })

  test('a free workspace sees upgrade notices for notes and testimony on the bill page', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })
    await trackFirstAvailableBill(page)

    await expect(page.getByText('The Free plan does not include notes.')).toBeVisible()
    await expect(page.getByPlaceholder('Add a note about this bill…')).toHaveCount(0)
    const testimony = page.getByRole('region', { name: 'Testimony' })
    await expect(testimony.getByText('The Free plan does not include testimony drafts.')).toBeVisible()
    await expect(testimony.getByRole('button', { name: '+ Draft' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'See the plans' }).first()).toHaveAttribute('href', '/plans')
  })

  test('a free workspace sees an upgrade notice on the testimony page, and the API refuses notes and testimony', async ({
    page,
  }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })
    const [bill] = await sessionBills(page)

    const note = await page.request.post(`${API_BASE}/api/notes`, { data: { billId: bill.id, body: 'E2E note' } })
    expect(note.status()).toBe(402)
    const draft = await page.request.post(`${API_BASE}/api/testimony`, { data: { billId: bill.id, body: 'E2E testimony' } })
    expect(draft.status()).toBe(402)

    await page.goto('/testimony')
    await expect(page.getByText('The Free plan does not include testimony drafts.')).toBeVisible()
    await expect(page.getByRole('button', { name: '+ New testimony' })).toHaveCount(0)
  })

  test('after an upgrade, the note form is available and saves', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })
    const [bill] = await sessionBills(page)
    expect((await page.request.post(`${API_BASE}/api/bills/${bill.id}/track`)).ok()).toBeTruthy()

    await setWorkspacePlan(page, 'single_user', { path: `/bills/${bill.id}` })
    const noteInput = page.getByPlaceholder('Add a note about this bill…')
    await noteInput.fill('E2E note after the upgrade')
    await noteInput.locator('..').getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('E2E note after the upgrade')).toBeVisible()
  })
})

test.describe('AI summaries by plan', () => {
  const AI_SUMMARY = {
    overview: 'The committee reviewed the water rights report. Members asked about the drought plan.',
    topics: [{ title: 'Water rights report', summary: 'Staff presented the report.', startSeconds: 10 }],
    actions: [{ text: 'Staff will send the drought plan to members.', startSeconds: null }],
  }
  const SEGMENTS = [{ start: 0, end: 20, text: 'Good morning, the committee will come to order.' }]

  test('a free workspace sees the first sentence of a hearing summary and an upgrade notice', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })
    const hearing = await createHearingFixture(page.request, { segments: SEGMENTS, aiSummary: AI_SUMMARY })

    await page.goto(`/hearings/recordings/${hearing.id}`)
    const summary = page.getByRole('region', { name: 'Summary' })
    await expect(summary).toContainText('The committee reviewed the water rights report.')
    await expect(summary).not.toContainText('Members asked about the drought plan.')
    await expect(summary.getByRole('list', { name: 'Topics' })).toHaveCount(0)
    await expect(summary.getByText('AI hearing summaries are included in the paid plans.')).toBeVisible()

    await setWorkspacePlan(page, 'single_user')
    await expect(summary).toContainText('Members asked about the drought plan.')
    await expect(summary.getByRole('list', { name: 'Topics' })).toContainText('Water rights report')
  })

  test('a free workspace does not see amendment summaries', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'free' })
    const billId = (await sessionBills(page))[14].id
    expect((await page.request.post(`${API_BASE}/api/bills/${billId}/track`)).ok()).toBeTruthy()
    const n = Math.floor(Math.random() * 1_000_000) + 1
    const summary = 'This amendment lowers the license fee to $35.'
    const res = await page.request.post(`${API_BASE}/api/__test__/bill-text`, {
      data: { billId: Number(billId), amendmentId: -n, documentId: -n * 4, summary },
    })
    expect(res.ok()).toBeTruthy()

    await page.goto(`/bills/${billId}`)
    const amendments = page.getByRole('region', { name: 'Amendments' })
    await expect(amendments.getByText('AI summaries of these amendments are included in the paid plans.')).toBeVisible()
    await expect(amendments.getByText(summary)).toHaveCount(0)

    await setWorkspacePlan(page, 'team')
    await expect(amendments.getByText(summary)).toBeVisible()
  })
})

test.describe('member limits', () => {
  test('a single user workspace cannot invite people', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'single_user' })
    await page.goto('/settings')
    await expect(page.getByText('The Single user plan is for 1 person. A Team plan can invite more people.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send invite' })).toHaveCount(0)

    const res = await page.request.post(`${API_BASE}/api/workspaces/${await workspaceId(page)}/invites`, {
      data: { email: `e2e-invitee-${uniqueSuffix()}@example.dev`, role: 'member' },
    })
    expect(res.status()).toBe(402)
  })

  test('a team workspace can have 10 people, and open invites count', async ({ page }) => {
    await signUpFreshWorkspace(page, { plan: 'team' })
    const id = await workspaceId(page)
    // The admin and 9 open invites fill the 10 places.
    for (let i = 0; i < 9; i++) {
      const res = await page.request.post(`${API_BASE}/api/workspaces/${id}/invites`, {
        data: { email: `e2e-invitee-${uniqueSuffix()}-${i}@example.dev`, role: 'member' },
      })
      expect(res.ok()).toBeTruthy()
    }

    await page.goto('/settings')
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', `e2e-invitee-${uniqueSuffix()}@example.dev`)
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect(page.getByText('The Team plan is for 10 people. See the plans on the Plans page.')).toBeVisible()
  })

  test('an invite cannot be accepted after the workspace changes to a plan for 1 person', async ({ page, browser }) => {
    await signUpFreshWorkspace(page, { plan: 'team' })
    const email = `e2e-invitee-${uniqueSuffix()}@example.dev`
    await page.goto('/settings')
    await page.fill('input[type="email"][placeholder="teammate@example.org"]', email)
    await page.getByRole('button', { name: 'Send invite' }).click()
    await pendingInviteRow(page, email).waitFor()
    const token = await getLastEmailToken(page.request, email)

    await setWorkspacePlan(page, 'single_user')

    const context = await browser.newContext()
    const invitee = await context.newPage()
    await invitee.goto(`/accept-invite?token=${token}`)
    await invitee.fill('#name', 'E2E Invitee')
    await invitee.fill('#password', 'e2e-test-password-1')
    await invitee.getByRole('button', { name: 'Create account and join' }).click()
    await expect(
      invitee.getByText('This workspace has no place for more members. Ask a workspace admin to change the plan.'),
    ).toBeVisible()
    await expect(invitee).toHaveURL(/accept-invite/)
    await context.close()
  })
})

async function workspaceId(page: Page): Promise<number> {
  const me = await (await page.request.get(`${API_BASE}/api/auth/me`)).json()
  return me.currentWorkspace.id as number
}
