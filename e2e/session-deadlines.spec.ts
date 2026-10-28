import { test, expect, signUpFreshWorkspace } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

type Deadlines = {
  sessionId: number
  today: string
  deadlines: { code: string; transmitDay: number; transmitDate: string; returnDay: number; returnDate: string }[]
}

const LABELS: Record<string, string> = { GE: 'General bills', RE: 'Revenue bills', AP: 'Appropriation bills' }

async function sessionDeadlines(request: APIRequestContext): Promise<Deadlines> {
  const res = await request.post(`${API_BASE}/api/__test__/session-deadlines`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

// The same format as formatCalendarDate in src/lib/format.ts.
function calendarDate(day: string, options: { weekday?: boolean; year?: boolean } = {}): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: options.weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: options.year === false ? undefined : 'numeric',
  })
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

test.describe('session deadlines', () => {
  test('the dashboard counts down to the next transmittal deadline and lists the later ones', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const data = await sessionDeadlines(page.request)
    const upcoming = data.deadlines
      .filter((d) => d.transmitDate >= data.today)
      .sort((a, b) => a.transmitDate.localeCompare(b.transmitDate))
    test.skip(upcoming.length === 0, 'all the transmittal deadlines of the session have passed')
    const [next, ...later] = upcoming

    await page.goto('/')
    const cell = page.locator('[class*="_cell_"]').filter({ hasText: 'Days to transmittal' })
    await expect(cell).toContainText(String(daysBetween(data.today, next.transmitDate)))
    await expect(cell).toContainText(`${LABELS[next.code]} · ${calendarDate(next.transmitDate, { weekday: true })}`)
    for (const d of later) {
      await expect(cell).toContainText(
        `${LABELS[d.code].replace(/ bills$/, '').toLowerCase()} ${calendarDate(d.transmitDate, { year: false })}`,
      )
    }
    await expect(cell).not.toContainText('Date not set yet')
  })

  test('a bill page shows the transmittal and return deadlines of its deadline category', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const data = await sessionDeadlines(page.request)
    const general = data.deadlines.find((d) => d.code === 'GE')!
    const res = await page.request.post(`${API_BASE}/api/__test__/open-drafts`, { data: { count: 1, deadlineCode: 'GE', ageMinutes: 1440 } })
    expect(res.ok()).toBeTruthy()
    const [bill] = (await res.json()).bills as { billId: string }[]

    await page.goto(`/bills/${bill.billId}`)
    const section = page.getByRole('region', { name: 'Deadlines' })
    await expect(section).toContainText('General bills')
    const passed = (date: string) => (date < data.today ? ' · passed' : '')
    await expect(section).toContainText(`Transmittal${calendarDate(general.transmitDate)}${passed(general.transmitDate)}`)
    await expect(section).toContainText(`Return${calendarDate(general.returnDate)}${passed(general.returnDate)}`)
    await expect(section).toContainText(`Legislative day ${general.transmitDay} and day ${general.returnDay}.`)
  })

  test('an LC draft without a deadline category shows no deadlines', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await sessionDeadlines(page.request)
    const res = await page.request.post(`${API_BASE}/api/__test__/open-drafts`, { data: { count: 1, ageMinutes: 1440 } })
    const [bill] = (await res.json()).bills as { billId: string; title: string }[]

    await page.goto(`/bills/${bill.billId}`)
    await expect(page.getByRole('heading', { name: bill.title })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Deadlines' })).toHaveCount(0)
  })
})
