import type { CalendarEvent } from '../types'

// Dates in this file are "YYYY-MM-DD" strings. The event times are naive
// Montana wall-clock times. The functions use UTC Date objects only to count
// days, so the time zone of the browser does not change a date.

const DAY_MS = 86_400_000

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Today in Montana. */
export function todayInMontana(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(now)
}

export function addDays(day: string, days: number): string {
  return toDay(new Date(toDate(day).getTime() + days * DAY_MS))
}

/** The Monday of the week of the date. */
export function weekStart(day: string): string {
  const weekday = toDate(day).getUTCDay() // 0 is Sunday.
  return addDays(day, -((weekday + 6) % 7))
}

/** The 7 dates of the week that starts on the date. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** The first date of the month of the date. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/** The first date of the next month (months > 0) or of an earlier month. */
export function addMonths(day: string, months: number): string {
  const d = toDate(monthStart(day))
  d.setUTCMonth(d.getUTCMonth() + months)
  return toDay(d)
}

/** The 42 dates (6 weeks, from a Monday) that the month view shows. */
export function monthGridDays(month: string): string[] {
  const start = weekStart(monthStart(month))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function formatDay(day: string, options: Intl.DateTimeFormatOptions): string {
  return toDate(day).toLocaleDateString('en-US', { timeZone: 'UTC', ...options })
}

/** "Oct 26 to Nov 1" */
export function formatRange(first: string, last: string): string {
  const short = { month: 'short', day: 'numeric' } as const
  return `${formatDay(first, short)} to ${formatDay(last, short)}`
}

export function eventDay(event: CalendarEvent): string {
  return event.start.slice(0, 10)
}

/** "8:00 am", "3:30 pm" */
export function formatTime(naive: string): string {
  const [h, m] = naive.slice(11, 16).split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

// ---------------------------------------------------------------- add to calendar

// A meeting with no end time shows as one hour long.
function endTime(event: CalendarEvent): string {
  if (event.end && event.end > event.start) return event.end
  const end = new Date(`${event.start.slice(0, 19).replace(' ', 'T')}Z`).getTime() + 3_600_000
  return new Date(end).toISOString().slice(0, 19).replace('T', ' ')
}

/** "2027-01-12 15:00:00" to "20270112T150000" */
function compact(naive: string): string {
  return naive.slice(0, 19).replace(/[-:]/g, '').replace(' ', 'T')
}

function eventUrl(event: CalendarEvent, origin: string): string {
  if (event.bills.length === 1) return `${origin}/bills/${event.bills[0].id}`
  if (event.committeeId) return `${origin}/committees/${event.committeeId}`
  return origin
}

function eventDetails(event: CalendarEvent, origin: string): string {
  const lines = event.bills.map((b) => `${b.identifier}${b.title ? `: ${b.title}` : ''} (${origin}/bills/${b.id})`)
  if (lines.length > 0) return `Tracked bills on the agenda:\n${lines.join('\n')}`
  return `Committee page: ${eventUrl(event, origin)}`
}

/** A link that opens a new Google Calendar event with the details filled in. */
export function googleCalendarUrl(event: CalendarEvent, origin = window.location.origin): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compact(event.start)}/${compact(endTime(event))}`,
    ctz: 'America/Denver',
    details: eventDetails(event, origin),
  })
  if (event.location) params.set('location', event.location)
  return `https://calendar.google.com/calendar/render?${params}`
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// Lines of an iCalendar file have a maximum of 75 characters. A longer line
// continues on the next line, after one space.
function fold(line: string): string {
  const parts: string[] = []
  for (let i = 0; i < line.length; i += i === 0 ? 75 : 74) parts.push(line.slice(i, i + (i === 0 ? 75 : 74)))
  return parts.join('\r\n ')
}

// The US daylight saving time rules for Montana, so that calendar programs
// that do not know "America/Denver" by name show the correct time.
const DENVER_TIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Denver',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0600',
  'TZNAME:MDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0700',
  'TZNAME:MST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/** An iCalendar (.ics) file with the events. Apple Calendar and Outlook open it. */
export function buildIcs(events: CalendarEvent[], origin = window.location.origin, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rotunda Board//Calendar//EN', 'CALSCALE:GREGORIAN', ...DENVER_TIMEZONE]
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}-${compact(event.start)}@rotundaboard`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/Denver:${compact(event.start)}`,
      `DTEND;TZID=America/Denver:${compact(endTime(event))}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []),
      `DESCRIPTION:${escapeIcs(eventDetails(event, origin))}`,
      `URL:${eventUrl(event, origin)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Starts the download of an .ics file with the events. */
export function downloadIcs(filename: string, events: CalendarEvent[]) {
  const url = URL.createObjectURL(new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
