import { readFile } from 'node:fs/promises'
import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill, uniqueSuffix } from './fixtures'
import type { Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

// A bill that the other specs do not track, so that their hearing fixtures
// do not show in this calendar.
const CALENDAR_BILL = 9

// Today in Montana, "YYYY-MM-DD". The fixtures below are at the current time,
// so they are always in the current week and month.
function todayInMontana(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date())
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

// A hearing of a tracked bill and a meeting of a followed committee, both now.
async function setUpEvents(page: Page) {
  await signUpFreshWorkspace(page)
  const bill = await trackFirstAvailableBill(page, { index: CALENDAR_BILL })
  const room = `Room ${uniqueSuffix()} (E2E)`
  const n = Math.floor(Math.random() * 1_000_000_000) + 1
  const hearing = await page.request.post(`${API_BASE}/api/__test__/bill-hearing`, {
    data: { billId: Number(bill.billId), hearingId: -n, meetingId: -n, hoursFromNow: 0, location: room },
  })
  expect(hearing.ok()).toBeTruthy()
  const { committee: hearingCommittee } = (await hearing.json()) as { committee: string }

  const meetingRoom = `Annex ${uniqueSuffix()} (E2E)`
  const res = await page.request.post(`${API_BASE}/api/__test__/committee-meeting`, {
    data: { daysFromNow: 0, location: meetingRoom },
  })
  const meeting = (await res.json()) as { committeeId: string; committee: string }
  await page.request.post(`${API_BASE}/api/committees/${meeting.committeeId}/follow`)
  return { bill, room, hearingCommittee, meeting, meetingRoom }
}

test.describe('dashboard calendar', () => {
  test('the week shows the hearings of tracked bills and the meetings of followed committees', async ({ page }) => {
    const { bill, room, hearingCommittee, meeting, meetingRoom } = await setUpEvents(page)
    await page.goto('/')

    const calendar = page.getByRole('region', { name: 'Calendar' })
    await expect(calendar).toContainText('This week')
    await expect(page.getByRole('region', { name: 'Get set up' })).toHaveCount(0)
    const today = calendar.getByRole('group', { name: dayLabel(todayInMontana()) })
    // Other tests use the same bill and committee, so find the events by room.
    const hearingChip = today.getByRole('button', { name: `${hearingCommittee} hearing: ${bill.identifier}, ${room}` })
    await expect(hearingChip).toBeVisible()
    await expect(today.getByRole('button', { name: `${meeting.committee}, ${meetingRoom}` })).toBeVisible()

    // The event dialog shows the details and opens the bill in the drawer.
    await hearingChip.click()
    const dialog = page.getByRole('dialog', { name: `${hearingCommittee} hearing` })
    await expect(dialog).toContainText(room)
    await expect(dialog).toContainText('Bill hearing')
    await dialog.getByRole('button', { name: new RegExp(bill.identifier) }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: `${bill.identifier} details` })).toBeVisible()
  })

  test('while the next week loads, the calendar keeps the current week, so the page below does not jump', async ({
    page,
  }) => {
    const { room } = await setUpEvents(page)
    // Hold back the response for every week except the current one.
    const monday = new Date(`${todayInMontana()}T00:00:00Z`)
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
    const thisWeek = monday.toISOString().slice(0, 10)
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/calendar?**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('from') !== thisWeek) await held
      await route.continue()
    })

    await page.goto('/')
    const calendar = page.getByRole('region', { name: 'Calendar' })
    const chip = calendar.getByRole('button', { name: room })
    await expect(chip).toBeVisible()
    const height = (await calendar.boundingBox())!.height

    await calendar.getByRole('button', { name: 'Next week' }).click()
    await expect(calendar).not.toContainText('This week')
    // The current week stays until the next week is loaded.
    await expect(chip).toBeVisible()
    expect((await calendar.boundingBox())!.height).toBe(height)

    release()
    await expect(chip).toHaveCount(0)
    await expect(calendar.getByRole('group', { name: dayLabel(todayInMontana()) })).toHaveCount(0)
  })

  test('"Next week" and "Today" move the week', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')
    const calendar = page.getByRole('region', { name: 'Calendar' })
    await expect(calendar).toContainText('This week')
    await calendar.getByRole('button', { name: 'Next week' }).click()
    await expect(calendar).not.toContainText('This week')
    await expect(calendar.getByRole('group', { name: dayLabel(todayInMontana()) })).toHaveCount(0)
    await calendar.getByRole('button', { name: 'Today' }).click()
    await expect(calendar).toContainText('This week')
    await expect(calendar.getByRole('group', { name: dayLabel(todayInMontana()) })).toBeVisible()
  })

  test('an event can be added to Google Calendar or downloaded as an .ics file', async ({ page }) => {
    const { meeting, meetingRoom } = await setUpEvents(page)
    await page.goto('/')
    const calendar = page.getByRole('region', { name: 'Calendar' })
    await calendar.getByRole('button', { name: `${meeting.committee}, ${meetingRoom}` }).click()
    const dialog = page.getByRole('dialog', { name: meeting.committee })
    await expect(dialog).toContainText(meetingRoom)

    const addTo = dialog.getByRole('group', { name: 'Add to calendar' })
    const google = new URL((await addTo.getByRole('link', { name: 'Google Calendar' }).getAttribute('href'))!)
    expect(google.hostname).toBe('calendar.google.com')
    expect(google.searchParams.get('text')).toBe(meeting.committee)
    expect(google.searchParams.get('ctz')).toBe('America/Denver')
    expect(google.searchParams.get('location')).toBe(meetingRoom)
    const today = todayInMontana().replace(/-/g, '')
    expect(google.searchParams.get('dates')).toMatch(new RegExp(`^${today}T\\d{6}/\\d{8}T\\d{6}$`))

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      addTo.getByRole('button', { name: 'Apple or Outlook (.ics)' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.ics$/)
    // Join the folded lines (a long line continues after a line break and a space).
    const ics = (await readFile((await download.path())!, 'utf8')).replace(/\r\n /g, '')
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain(`SUMMARY:${meeting.committee.replace(/,/g, '\\,')}`)
    expect(ics).toMatch(new RegExp(`DTSTART;TZID=America/Denver:${today}T\\d{6}`))
    expect(ics).toContain('BEGIN:VTIMEZONE')
  })

  test('"Add week to calendar" downloads every event of the week', async ({ page }) => {
    const { hearingCommittee, room, meeting } = await setUpEvents(page)
    await page.goto('/')
    const calendar = page.getByRole('region', { name: 'Calendar' })
    await expect(calendar.getByRole('button', { name: `${hearingCommittee} hearing` }).and(calendar.getByRole('button', { name: room }))).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      calendar.getByRole('button', { name: 'Add week to calendar' }).click(),
    ])
    // Join the folded lines (a long line continues after a line break and a space).
    const ics = (await readFile((await download.path())!, 'utf8')).replace(/\r\n /g, '')
    expect(ics).toContain(`SUMMARY:${hearingCommittee.replace(/,/g, '\\,')} hearing`)
    expect(ics).toContain(`SUMMARY:${meeting.committee.replace(/,/g, '\\,')}`)
  })

  test('the month view opens in a dialog, shows the events, and changes month', async ({ page }) => {
    const { hearingCommittee } = await setUpEvents(page)
    await page.goto('/')
    await page.getByRole('region', { name: 'Calendar' }).getByRole('button', { name: 'Month' }).click()

    const month = page.getByRole('dialog', { name: 'Month calendar' })
    const thisMonth = new Date(`${todayInMontana()}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    })
    await expect(month.getByRole('heading', { name: thisMonth })).toBeVisible()
    const today = month.getByRole('gridcell', { name: dayLabel(todayInMontana()) })
    // Other tests add hearings on the same day, so this one can be under "+N more".
    await today.getByRole('button', { name: `${hearingCommittee} hearing` }).first().click()
    // The event dialog opens above the month view. Escape closes only the event.
    const event = page.getByRole('dialog', { name: `${hearingCommittee} hearing` })
    await expect(event).toContainText('Bill hearing')
    await page.keyboard.press('Escape')
    await expect(event).toHaveCount(0)
    await expect(month).toBeVisible()

    await month.getByRole('button', { name: 'Next month' }).click()
    await expect(month.getByRole('heading', { name: thisMonth })).toHaveCount(0)
    await month.getByRole('button', { name: 'This month' }).click()
    await expect(month.getByRole('heading', { name: thisMonth })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(month).toHaveCount(0)
  })

  test('a meeting of a followed committee lists the tracked bills that its agenda names', async ({ page }) => {
    await signUpFreshWorkspace(page)
    // A draft from yesterday, so that it does not change the dashboard suggestions of other tests.
    const drafts = await page.request.post(`${API_BASE}/api/__test__/open-drafts`, { data: { count: 1, ageMinutes: 1440 } })
    const [draft] = (await drafts.json()).bills as { billId: string; identifier: string; title: string }[]
    expect((await page.request.post(`${API_BASE}/api/bills/${draft.billId}/track`)).ok()).toBeTruthy()
    const room = `Room ${uniqueSuffix()} (E2E)`
    const res = await page.request.post(`${API_BASE}/api/__test__/committee-meeting`, {
      data: { daysFromNow: 0, location: room, agenda: [`Discussion of ${draft.identifier}`] },
    })
    const meeting = (await res.json()) as { committeeId: string; committee: string }
    await page.request.post(`${API_BASE}/api/committees/${meeting.committeeId}/follow`)

    await page.goto('/')
    const calendar = page.getByRole('region', { name: 'Calendar' })
    await calendar.getByRole('button', { name: `${meeting.committee}: ${draft.identifier}, ${room}` }).click()
    const dialog = page.getByRole('dialog', { name: meeting.committee })
    await expect(dialog.getByRole('list', { name: 'Tracked bills on the agenda' })).toContainText(draft.title)
    await expect(dialog.getByRole('link', { name: 'Open the committee page →' })).toHaveAttribute(
      'href',
      `/committees/${meeting.committeeId}`,
    )
  })

  test('a week with no events says what the calendar shows', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/')
    const calendar = page.getByRole('region', { name: 'Calendar' })
    // A new workspace tracks no bills and follows no committees.
    await expect(calendar).toContainText('Nothing this week.')
    await expect(calendar.getByRole('button', { name: 'Add week to calendar' })).toBeDisabled()
  })
})
