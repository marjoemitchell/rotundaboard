import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../../data/client'
import type { CalendarEvent } from '../../types'
import {
  addDays,
  addMonths,
  downloadIcs,
  eventDay,
  formatDay,
  formatRange,
  formatTime,
  googleCalendarUrl,
  monthGridDays,
  monthStart,
  todayInMontana,
  weekDays,
  weekStart,
} from '../../lib/calendar'
import styles from './DashboardCalendar.module.css'

// The number of events that a day of the month view shows before "+N more".
const MONTH_CELL_EVENTS = 3

interface Shown {
  from: string
  events: CalendarEvent[]
}

// Loads the events of a date range, and keeps each loaded range in memory.
// While a new range loads, "shown" stays the previous range. The calendar then
// does not become empty for a moment, and the page below it does not jump.
// "load" also loads a range ahead of time, for example the next week.
function useCalendar(from: string, to: string): { shown: Shown | null; loading: boolean; load: (from: string, to: string) => void } {
  const loaded = useRef(new Map<string, CalendarEvent[]>())
  const pending = useRef(new Set<string>())
  const last = useRef<Shown | null>(null)
  const [, setVersion] = useState(0)

  const load = useCallback((f: string, t: string) => {
    const key = `${f}/${t}`
    if (loaded.current.has(key) || pending.current.has(key)) return
    pending.current.add(key)
    client
      .getCalendar(f, t)
      .then(
        ({ events }) => loaded.current.set(key, events),
        () => loaded.current.set(key, []),
      )
      .finally(() => {
        pending.current.delete(key)
        setVersion((v) => v + 1)
      })
  }, [])

  useEffect(() => load(from, to), [from, to, load])

  const events = loaded.current.get(`${from}/${to}`)
  if (events) last.current = { from, events }
  return { shown: last.current, loading: !events, load }
}

function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) map.set(eventDay(e), [...(map.get(eventDay(e)) ?? []), e])
  return map
}

function EventChip({ event, onOpen, compact }: { event: CalendarEvent; onOpen: () => void; compact?: boolean }) {
  const bills = event.bills.map((b) => b.identifier).join(', ')
  return (
    <button
      className={`${styles.event} ${event.kind === 'hearing' ? styles.hearing : styles.meeting} ${compact ? styles.compact : ''}`}
      onClick={onOpen}
      aria-label={`${formatTime(event.start)} ${event.title}${bills ? `: ${bills}` : ''}${event.location ? `, ${event.location}` : ''}`}
    >
      <span className={styles.eventTime}>{formatTime(event.start)}</span>
      <span className={styles.eventTitle}>{event.title}</span>
      {!compact && bills && <span className={styles.eventBills}>{bills}</span>}
    </button>
  )
}

function AddToCalendar({ events, filename, label }: { events: CalendarEvent[]; filename: string; label: string }) {
  return (
    <button className={styles.textButton} onClick={() => downloadIcs(filename, events)} disabled={events.length === 0}>
      {label}
    </button>
  )
}

function EventDialog({
  event,
  onClose,
  onSelectBill,
}: {
  event: CalendarEvent
  onClose: () => void
  onSelectBill: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const end = event.end && event.end > event.start ? ` to ${formatTime(event.end)}` : ''
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={ref}
        className={`${styles.dialog} ${styles.eventDialog}`}
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.dialogHead}>
          <span className={`eyebrow ${event.kind === 'hearing' ? styles.hearingLabel : styles.meetingLabel}`}>
            {event.kind === 'hearing' ? 'Bill hearing' : 'Committee meeting'}
          </span>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <h2 className={styles.dialogTitle}>{event.title}</h2>
        <p className={styles.when}>
          {formatDay(eventDay(event), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })},{' '}
          {formatTime(event.start)}
          {end}
        </p>
        {event.location && <p className={styles.where}>{event.location}</p>}

        {event.bills.length > 0 && (
          <ul className={styles.billList} aria-label="Tracked bills on the agenda">
            {event.bills.map((b) => (
              <li key={b.id}>
                <button
                  className={styles.billButton}
                  onClick={() => {
                    onClose()
                    onSelectBill(b.id)
                  }}
                >
                  <span className={styles.billId}>{b.identifier}</span>
                  {b.title && <span className={styles.billTitle}>{b.title}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {event.committeeId && (
          <Link className={styles.textButton} to={`/committees/${event.committeeId}`} onClick={onClose}>
            Open the committee page →
          </Link>
        )}

        <div className={styles.addTo} role="group" aria-label="Add to calendar">
          <span className={styles.addToLabel}>Add to calendar</span>
          <a className={styles.addButton} href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
            Google Calendar
          </a>
          <button className={styles.addButton} onClick={() => downloadIcs(`${event.id}.ics`, [event])}>
            Apple or Outlook (.ics)
          </button>
        </div>
      </div>
    </div>
  )
}

function MonthDialog({
  initialMonth,
  today,
  onClose,
  onOpenEvent,
  onPickWeek,
}: {
  initialMonth: string
  today: string
  onClose: () => void
  onOpenEvent: (event: CalendarEvent) => void
  onPickWeek: (day: string) => void
}) {
  const [month, setMonth] = useState(initialMonth)
  const target = monthGridDays(month)
  const { shown, loading, load } = useCalendar(target[0], target[41])
  // Load the months before and after ahead of time.
  useEffect(() => {
    if (loading) return
    for (const m of [addMonths(month, -1), addMonths(month, 1)]) {
      const days = monthGridDays(m)
      load(days[0], days[41])
    }
  }, [month, loading, load])
  // The grid shows the loaded month. The second week is always in that month.
  const shownMonth = shown ? monthStart(addDays(shown.from, 7)) : month
  const days = monthGridDays(shownMonth)
  const shownEvents = shown?.events ?? []
  const grouped = byDay(shownEvents)
  const monthEvents = shownEvents.filter((e) => eventDay(e).startsWith(shownMonth.slice(0, 7)))
  const label = formatDay(month, { month: 'long', year: 'numeric' })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={ref}
        className={`${styles.dialog} ${styles.monthDialog}`}
        role="dialog"
        aria-modal="true"
        aria-label="Month calendar"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.dialogHead}>
          <div className={styles.nav}>
            <button className={styles.navButton} onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
              ‹
            </button>
            <h2 className={styles.monthTitle}>{label}</h2>
            <button className={styles.navButton} onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
              ›
            </button>
            {month !== monthStart(today) && (
              <button className={styles.textButton} onClick={() => setMonth(monthStart(today))}>
                This month
              </button>
            )}
          </div>
          <div className={styles.headActions}>
            <AddToCalendar
              events={loading ? [] : monthEvents}
              filename={`rotunda-board-${month.slice(0, 7)}.ics`}
              label="Add month to calendar"
            />
            <button className={styles.close} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div
          className={`${styles.monthGrid} ${loading && shown ? styles.loading : ''}`}
          role="grid"
          aria-label={label}
          aria-busy={loading}
        >
          <div role="row" className={styles.monthRow}>
            {days.slice(0, 7).map((d) => (
              <div key={d} role="columnheader" className={styles.weekdayHead}>
                {formatDay(d, { weekday: 'short' })}
              </div>
            ))}
          </div>
          {[0, 1, 2, 3, 4, 5].map((w) => (
            <div key={w} role="row" className={styles.monthRow}>
              {days.slice(w * 7, w * 7 + 7).map((d) => {
                const dayEvents = grouped.get(d) ?? []
                const extra = dayEvents.length - MONTH_CELL_EVENTS
                const outside = d.slice(0, 7) !== shownMonth.slice(0, 7)
                return (
                  <div
                    key={d}
                    role="gridcell"
                    aria-label={formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                    className={`${styles.monthCell} ${outside ? styles.outside : ''} ${d === today ? styles.today : ''}`}
                  >
                    <button className={styles.dayNumber} onClick={() => onPickWeek(d)} aria-label={`Show the week of ${formatDay(d, { month: 'long', day: 'numeric' })}`}>
                      {Number(d.slice(8))}
                    </button>
                    {dayEvents.slice(0, MONTH_CELL_EVENTS).map((e) => (
                      <EventChip key={e.id} event={e} onOpen={() => onOpenEvent(e)} compact />
                    ))}
                    {extra > 0 && (
                      <button className={styles.more} onClick={() => onPickWeek(d)}>
                        +{extra} more
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        {shown && monthEvents.length === 0 && (
          <p className={styles.emptyNote}>No hearings of tracked bills or meetings of followed committees in this month.</p>
        )}
      </div>
    </div>
  )
}

// The week calendar of the dashboard: the hearings of the tracked bills and
// the meetings of the followed committees. "Month" opens a month view.
export function DashboardCalendar({ onSelectBill }: { onSelectBill: (id: string) => void }) {
  const today = todayInMontana()
  const [start, setStart] = useState(() => weekStart(today))
  const target = weekDays(start)
  const { shown, loading, load } = useCalendar(target[0], target[6])
  // Load the weeks before and after ahead of time, so that the arrows change
  // the week at once.
  useEffect(() => {
    if (loading) return
    load(addDays(start, -7), addDays(start, -1))
    load(addDays(start, 7), addDays(start, 13))
  }, [start, loading, load])
  // The grid shows the loaded week. The header shows the chosen week at once.
  const days = shown ? weekDays(shown.from) : target
  const weekEvents = shown?.events ?? []
  const grouped = byDay(weekEvents)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [monthOpen, setMonthOpen] = useState(false)
  const monthButton = useRef<HTMLButtonElement>(null)

  // Escape closes the top dialog: the event first, then the month view.
  useEffect(() => {
    if (!selected && !monthOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) setSelected(null)
      else {
        setMonthOpen(false)
        monthButton.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selected, monthOpen])

  const thisWeek = start === weekStart(today)

  return (
    <section className={styles.card} aria-label="Calendar">
      <div className={styles.head}>
        <div className={styles.nav}>
          <span className="eyebrow">{thisWeek ? 'This week' : 'Week'}</span>
          <button className={styles.navButton} onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
            ‹
          </button>
          <span className={styles.range}>{formatRange(target[0], target[6])}</span>
          <button className={styles.navButton} onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
            ›
          </button>
          {!thisWeek && (
            <button className={styles.textButton} onClick={() => setStart(weekStart(today))}>
              Today
            </button>
          )}
        </div>
        <div className={styles.headActions}>
          <AddToCalendar
            events={loading ? [] : weekEvents}
            filename={`rotunda-board-week-${start}.ics`}
            label="Add week to calendar"
          />
          <button ref={monthButton} className={styles.monthButton} onClick={() => setMonthOpen(true)}>
            Month
          </button>
        </div>
      </div>

      <div className={`${styles.week} ${loading && shown ? styles.loading : ''}`} aria-busy={loading}>
        {days.map((d) => {
          const dayEvents = grouped.get(d) ?? []
          return (
            <div
              key={d}
              className={`${styles.day} ${d === today ? styles.today : ''} ${dayEvents.length === 0 ? styles.dayEmpty : ''}`}
              aria-label={formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}
              role="group"
            >
              <div className={styles.dayHead}>
                <span className={styles.weekday}>{formatDay(d, { weekday: 'short' })}</span>
                <span className={styles.dayNum}>{Number(d.slice(8))}</span>
              </div>
              {dayEvents.map((e) => (
                <EventChip key={e.id} event={e} onOpen={() => setSelected(e)} />
              ))}
            </div>
          )
        })}
      </div>
      {shown && weekEvents.length === 0 && (
        <p className={styles.emptyNote}>
          Nothing this week. Hearings of your tracked bills and meetings of your{' '}
          <Link to="/committees">followed committees</Link> show here.
        </p>
      )}

      {monthOpen && (
        <MonthDialog
          initialMonth={monthStart(start)}
          today={today}
          onClose={() => {
            setMonthOpen(false)
            monthButton.current?.focus()
          }}
          onOpenEvent={setSelected}
          onPickWeek={(d) => {
            setStart(weekStart(d))
            setMonthOpen(false)
          }}
        />
      )}
      {selected && <EventDialog event={selected} onClose={() => setSelected(null)} onSelectBill={onSelectBill} />}
    </section>
  )
}
