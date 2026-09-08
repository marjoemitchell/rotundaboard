import { test as base, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// Every workspace/user created by this suite is named/emailed with these
// prefixes on purpose — server/src/e2eCleanup.ts (run as Playwright's
// globalTeardown) sweeps rows matching them and nothing else, so the seeded
// dev data (Montana Conservation Coalition, casey@example.dev, etc.) is
// never touched.
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

export type FreshWorkspace = {
  email: string
  password: string
  name: string
  workspaceName: string
}

export async function signUpFreshWorkspace(page: Page, overrides?: Partial<FreshWorkspace>): Promise<FreshWorkspace> {
  const suffix = uniqueSuffix()
  const info: FreshWorkspace = {
    email: overrides?.email ?? `e2e-${suffix}@example.dev`,
    password: overrides?.password ?? 'e2e-test-password-1',
    name: overrides?.name ?? 'E2E Tester',
    workspaceName: overrides?.workspaceName ?? `E2E Workspace ${suffix}`,
  }
  await page.goto('/signup')
  await page.fill('#workspaceName', info.workspaceName)
  await page.fill('#name', info.name)
  await page.fill('#email', info.email)
  await page.fill('#password', info.password)
  await page.click('button[type="submit"]')
  await page.waitForURL('/')
  return info
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL('/')
}

export async function logout(page: Page) {
  await page.click('button:has-text("Log out")')
  await page.waitForURL('/login')
}

// Not every session has bills on record (an "upcoming" one might have zero),
// so anything that needs to click through to a session's bill list looks
// this up first rather than assuming whichever session card renders first
// has content.
export async function findSessionIdWithBills(page: Page): Promise<string> {
  const sessions = await page.evaluate(async (apiBase) => {
    const res = await fetch(`${apiBase}/api/sessions`, { credentials: 'include' })
    return (await res.json()) as { id: string; billCount: number }[]
  }, API_BASE)
  const best = [...sessions].sort((a, b) => b.billCount - a.billCount)[0]
  if (!best || best.billCount === 0) throw new Error('no session with any bills found')
  return best.id
}

// A fresh workspace starts with zero tracked bills (that's the whole point
// of the multi-tenant isolation model), so any test touching bill-detail
// features needs to track one first. Picking a real bill to track via the
// API first (rather than clicking through whichever session card happens
// to be listed first) avoids landing on a session with zero bills — the
// actual Sessions -> session bills -> bill detail browse path gets its own
// dedicated coverage elsewhere, so this helper optimizes for reliable setup.
export async function trackFirstAvailableBill(page: Page): Promise<{ billId: string; identifier: string }> {
  const sessionId = await findSessionIdWithBills(page)
  const bills = await page.evaluate(
    async ({ apiBase, sessionId }) => {
      const res = await fetch(`${apiBase}/api/sessions/${sessionId}/bills`, { credentials: 'include' })
      return (await res.json()) as { id: string; identifier: string }[]
    },
    { apiBase: API_BASE, sessionId },
  )
  const bill = bills[0]

  await page.goto(`/bills/${bill.id}`)
  await page.click('button:has-text("+ Track this bill")')
  await page.waitForSelector('button:has-text("Stop tracking")', { timeout: 10000 })
  return { billId: bill.id, identifier: bill.identifier }
}

// Finds and tracks a bill that reached a final outcome (became law, or
// died/failed once its session ended) — for coverage of the outcome badge
// that replaces the live momentum tracker once a bill's process is over.
// findSessionIdWithBills picks the session with the most bills, which is
// always the one concluded 2025 session here — every bill in a session
// whose sine die date has passed gets a non-null outcome (see
// determineOutcome in server/src/momentum.ts), so the first bill returned
// already qualifies; no search needed.
export async function trackBillWithOutcome(page: Page): Promise<{ billId: string; identifier: string }> {
  const sessionId = await findSessionIdWithBills(page)
  const bills = await page.evaluate(
    async ({ apiBase, sessionId }) => {
      const res = await fetch(`${apiBase}/api/sessions/${sessionId}/bills`, { credentials: 'include' })
      return (await res.json()) as { id: string; identifier: string }[]
    },
    { apiBase: API_BASE, sessionId },
  )
  const bill = bills[0]

  await page.goto(`/bills/${bill.id}`)
  await page.click('button:has-text("+ Track this bill")')
  await page.waitForSelector('button:has-text("Stop tracking")', { timeout: 10000 })
  return { billId: bill.id, identifier: bill.identifier }
}

// Tracks one LC-prefixed (pre-introduction) bill and one introduced (HB/SB)
// bill from the session with the most bills on record, for tests exercising
// the Dashboard's LC Drafts / Introduced quick filters.
export async function trackOneLcAndOneIntroducedBill(
  page: Page,
): Promise<{ lc: { billId: string; identifier: string }; introduced: { billId: string; identifier: string } }> {
  const sessionId = await findSessionIdWithBills(page)
  const bills = await page.evaluate(
    async ({ apiBase, sessionId }) => {
      const res = await fetch(`${apiBase}/api/sessions/${sessionId}/bills`, { credentials: 'include' })
      return (await res.json()) as { id: string; identifier: string }[]
    },
    { apiBase: API_BASE, sessionId },
  )
  const lcBill = bills.find((b) => b.identifier.startsWith('LC'))
  const introducedBill = bills.find((b) => !b.identifier.startsWith('LC'))
  if (!lcBill || !introducedBill) throw new Error('could not find both an LC and an introduced bill to track')

  for (const bill of [lcBill, introducedBill]) {
    await page.goto(`/bills/${bill.id}`)
    await page.click('button:has-text("+ Track this bill")')
    await page.waitForSelector('button:has-text("Stop tracking")', { timeout: 10000 })
  }

  return {
    lc: { billId: lcBill.id, identifier: lcBill.identifier },
    introduced: { billId: introducedBill.id, identifier: introducedBill.identifier },
  }
}

// Reads back an invite/reset-password email captured by the server's
// dev/test-only inbox (see server/src/auth/email.ts + the
// /api/__test__/last-email route) and pulls the link's token query param out
// of it — this works whether or not RESEND_API_KEY is set, since sendEmail()
// always keeps a copy regardless of where (or whether) it actually sends.
export async function getLastEmailToken(request: APIRequestContext, to: string): Promise<string> {
  const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(to)}`)
  if (!res.ok()) throw new Error(`no captured email found for ${to} (${res.status()})`)
  const body = (await res.json()) as { html: string }
  const match = body.html.match(/[?&]token=([^"&\s]+)/)
  if (!match) throw new Error(`captured email for ${to} had no token link`)
  return match[1]
}

// SettingsPage shows a transient "Invite sent to X" notice in the same
// breath as the pending-invites row for that same email, so a plain
// `text=` locator for the email matches both and trips Playwright's
// strict-mode check. Scope to the pending-invite row itself instead.
export function pendingInviteRow(page: Page, email: string) {
  return page.locator('[class*="inviteRow"]', { hasText: email })
}

// Invites a brand-new account into the workspace `adminPage` is currently in
// and accepts it in a fresh browser context, landing the new member on the
// dashboard. Returns their own page/context so the caller can act as them.
export async function inviteAndAcceptMember(
  adminPage: Page,
  browser: Browser,
  role: 'admin' | 'member' = 'member',
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page; email: string; password: string }> {
  const suffix = uniqueSuffix()
  const email = `e2e-member-${suffix}@example.dev`
  const password = 'e2e-test-password-1'

  await adminPage.goto('/settings')
  await adminPage.fill('input[type="email"][placeholder="teammate@example.org"]', email)
  // Scope to the invite form specifically — member rows in the Team list
  // above also render a role <select> once there's more than one member.
  await adminPage.locator('form').locator('select').selectOption(role)
  await adminPage.click('button:has-text("Send invite")')
  await adminPage.locator('[class*="inviteRow"]', { hasText: email }).waitFor()

  const token = await getLastEmailToken(adminPage.request, email)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/accept-invite?token=${token}`)
  await page.fill('#name', 'E2E Invited Member')
  await page.fill('#password', password)
  await page.click('button:has-text("Create account and join")')
  await page.waitForURL('/')

  return { context, page, email, password }
}

export const test = base.extend<{ freshWorkspace: FreshWorkspace }>({
  freshWorkspace: async ({ page }, use) => {
    const info = await signUpFreshWorkspace(page)
    await use(info)
  },
})

export { expect }
