import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// Alert runs process every pending change, so run this file's tests in order.
test.describe.configure({ mode: 'serial' })

// A bill that the other alert specs do not use, so their alert runs do not
// add their changes to the emails in this file.
const HEARING_BILL = 5

type CapturedEmail = { subject: string; html: string; text: string | null; sentAt: number }

async function lastEmail(request: APIRequestContext, to: string): Promise<CapturedEmail | null> {
  const res = await request.get(`${API_BASE}/api/__test__/last-email?to=${encodeURIComponent(to)}`)
  return res.ok() ? res.json() : null
}

async function runAlerts(request: APIRequestContext) {
  const res = await request.post(`${API_BASE}/api/__test__/alerts/run`, { data: {} })
  expect(res.ok()).toBeTruthy()
}

// Each test uses its own negative ids for the fixture hearing and meeting.
function fixtureIds() {
  const n = Math.floor(Math.random() * 1_000_000_000) + 1
  return { hearingId: -n, meetingId: -n }
}

async function setHearing(
  request: APIRequestContext,
  input: { billId: string; hearingId: number; meetingId: number; hoursFromNow: number } & Record<string, unknown>,
): Promise<{ committee: string }> {
  const res = await request.post(`${API_BASE}/api/__test__/bill-hearing`, {
    data: { location: 'Room 152 (E2E)', ...input, billId: Number(input.billId) },
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

async function chooseDailyDigest(page: Page) {
  await page.goto('/settings')
  const section = page.getByRole('region', { name: 'Email alerts' })
  await section.getByRole('radio', { name: /Daily digest/ }).check()
  await expect(section.getByRole('status')).toHaveText('Saved')
}

test.beforeAll(async ({ request }) => {
  // The first alert run in an empty database only records a baseline.
  await runAlerts(request)
})

test.describe('hearing alerts', () => {
  test('a new hearing on a tracked bill alerts right away, with the committee, time, room, and a testimony link', async ({
    page,
  }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId, identifier } = await trackFirstAvailableBill(page, { index: HEARING_BILL })
    // Daily digest: hearing alerts must still go out right away.
    await chooseDailyDigest(page)

    const ids = fixtureIds()
    const { committee } = await setHearing(page.request, { billId, ...ids, hoursFromNow: 48 })
    await runAlerts(page.request)

    const email = await lastEmail(page.request, user.email)
    expect(email?.subject).toMatch(new RegExp(`^Hearing scheduled: ${identifier}, (Mon|Tue|Wed|Thu|Fri|Sat|Sun), `))
    expect(email?.html).toContain(`Hearing scheduled: ${committee}`)
    expect(email?.html).toContain('Room 152 (E2E)')
    expect(email?.html).toMatch(new RegExp(`<a href="[^"]*/bills/${billId}#testimony"[^>]*>Prepare testimony</a>`))
  })

  test('moving a hearing, canceling it, or removing a bill from the agenda sends updated alerts', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: HEARING_BILL })
    const ids = fixtureIds()

    await setHearing(page.request, { billId, ...ids, hoursFromNow: 48 })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.subject).toMatch(/^Hearing scheduled:/)

    await setHearing(page.request, { billId, ...ids, hoursFromNow: 72 })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.subject).toMatch(/^Hearing moved:/)

    // The time can change together with the cancellation.
    await setHearing(page.request, { billId, ...ids, hoursFromNow: 80, meetingStatus: 'CANCELED' })
    await runAlerts(page.request)
    const canceled = await lastEmail(page.request, user.email)
    expect(canceled?.subject).toMatch(/^Hearing canceled:/)
    expect(canceled?.html).not.toContain('Prepare testimony')

    // A second hearing: the bill is taken off the agenda (it is no longer in
    // the schedule), but the meeting itself stays.
    const other = fixtureIds()
    await setHearing(page.request, { billId, ...other, hoursFromNow: 96 })
    await runAlerts(page.request)
    await setHearing(page.request, { billId, ...other, hoursFromNow: 96, removed: true })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.subject).toMatch(/^Hearing canceled:/)

    // Nothing new: no more emails.
    const before = (await lastEmail(page.request, user.email))?.sentAt
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(before)
  })

  test('a reminder goes out about 24 hours before a hearing, unless the person turns reminders off', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: HEARING_BILL })

    const ids = fixtureIds()
    await setHearing(page.request, { billId, ...ids, hoursFromNow: 20 })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.subject).toMatch(/^Hearing scheduled:/)

    // The announcement was 7 hours ago: the reminder is due now.
    await page.request.post(`${API_BASE}/api/__test__/age-hearing-alert`, { data: { hearingId: ids.hearingId, hours: 7 } })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.subject).toMatch(/^Hearing reminder:/)

    // Reminders off: the next hearing gets the announcement, not the reminder.
    await page.goto('/settings')
    const section = page.getByRole('region', { name: 'Email alerts' })
    const reminders = section.getByRole('group', { name: 'Remind me before a hearing' })
    await expect(reminders.getByRole('checkbox', { name: '1 day before' })).toBeChecked()
    await reminders.getByRole('checkbox', { name: '1 day before' }).uncheck()
    await expect(section.getByRole('status')).toHaveText('Saved')
    await page.reload()
    await expect(reminders.getByRole('checkbox', { name: '1 day before' })).not.toBeChecked()

    const next = fixtureIds()
    await setHearing(page.request, { billId, ...next, hoursFromNow: 22 })
    await runAlerts(page.request)
    const announcement = await lastEmail(page.request, user.email)
    expect(announcement?.subject).toMatch(/^Hearing scheduled:/)
    await page.request.post(`${API_BASE}/api/__test__/age-hearing-alert`, { data: { hearingId: next.hearingId, hours: 7 } })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(announcement?.sentAt)
  })

  test('a person can choose reminders 2 days and 2 hours before a hearing instead of 1 day', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: HEARING_BILL })

    await page.goto('/settings')
    const section = page.getByRole('region', { name: 'Email alerts' })
    const reminders = section.getByRole('group', { name: 'Remind me before a hearing' })
    await reminders.getByRole('checkbox', { name: '2 days before' }).check()
    await expect(section.getByRole('status')).toHaveText('Saved')
    await reminders.getByRole('checkbox', { name: '2 hours before' }).check()
    await expect(section.getByRole('status')).toHaveText('Saved')
    await reminders.getByRole('checkbox', { name: '1 day before' }).uncheck()
    await expect(section.getByRole('status')).toHaveText('Saved')
    await page.reload()
    await expect(reminders.getByRole('checkbox', { name: '2 days before' })).toBeChecked()
    await expect(reminders.getByRole('checkbox', { name: '1 day before' })).not.toBeChecked()
    await expect(reminders.getByRole('checkbox', { name: '2 hours before' })).toBeChecked()

    // A hearing in 47 hours, announced 7 hours ago: the 2-day reminder is due.
    const twoDays = fixtureIds()
    await setHearing(page.request, { billId, ...twoDays, hoursFromNow: 47 })
    await runAlerts(page.request)
    await page.request.post(`${API_BASE}/api/__test__/age-hearing-alert`, { data: { hearingId: twoDays.hearingId, hours: 7 } })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.subject).toMatch(/^Hearing reminder:/)

    // A hearing in 20 hours: the 1-day reminder is off, so no email.
    const oneDay = fixtureIds()
    await setHearing(page.request, { billId, ...oneDay, hoursFromNow: 20 })
    await runAlerts(page.request)
    const announcement = await lastEmail(page.request, user.email)
    expect(announcement?.subject).toMatch(/^Hearing scheduled:/)
    await page.request.post(`${API_BASE}/api/__test__/age-hearing-alert`, { data: { hearingId: oneDay.hearingId, hours: 7 } })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(announcement?.sentAt)

    // A hearing in 2.5 hours, announced 7 hours ago: the 2-hour reminder is due.
    const twoHours = fixtureIds()
    await setHearing(page.request, { billId, ...twoHours, hoursFromNow: 2.5 })
    await runAlerts(page.request)
    await page.request.post(`${API_BASE}/api/__test__/age-hearing-alert`, { data: { hearingId: twoHours.hearingId, hours: 7 } })
    await runAlerts(page.request)
    const reminder = await lastEmail(page.request, user.email)
    expect(reminder?.subject).toMatch(/^Hearing reminder:/)

    // Each reminder goes out one time only.
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(reminder?.sentAt)
  })

  test('a hearing that was announced after the time of the reminder gets no reminder', async ({ page }) => {
    const user = await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: HEARING_BILL })

    // A hearing in 10 hours, announced 8 hours ago: 18 hours before the
    // hearing, which is after the time of the 1-day reminder.
    const ids = fixtureIds()
    await setHearing(page.request, { billId, ...ids, hoursFromNow: 10 })
    await runAlerts(page.request)
    const announcement = await lastEmail(page.request, user.email)
    expect(announcement?.subject).toMatch(/^Hearing scheduled:/)
    await page.request.post(`${API_BASE}/api/__test__/age-hearing-alert`, { data: { hearingId: ids.hearingId, hours: 8 } })
    await runAlerts(page.request)
    expect((await lastEmail(page.request, user.email))?.sentAt).toBe(announcement?.sentAt)
  })

  test('the "Prepare testimony" link opens the testimony form on the bill page', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { billId } = await trackFirstAvailableBill(page, { index: HEARING_BILL })

    await page.goto(`/bills/${billId}#testimony`)
    const section = page.getByRole('region', { name: 'Testimony' })
    await expect(section).toBeInViewport()
    await expect(section.locator('textarea')).toBeVisible()
  })
})

test.describe('hearing schedule freshness', () => {
  test('the hearing schedule job appears in the data freshness details', async ({ page }) => {
    const res = await page.request.post(`${API_BASE}/api/__test__/scrape-run`, {
      data: { job: 'refresh-hearings', status: 'ok', hoursAgo: 1 },
    })
    expect(res.ok()).toBeTruthy()
    await signUpFreshWorkspace(page)
    await expect(page.getByLabel('Data freshness')).toHaveAttribute('title', new RegExp(`Bill hearings: \\w+ \\d+`))
  })
})
