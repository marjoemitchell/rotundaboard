import { Link } from 'react-router-dom'
import type { LoadState, UpcomingMeetings } from '../../types'
import { plural } from '../../lib/format'
import styles from './DashboardCards.module.css'

function dateParts(iso: string) {
  const d = new Date(iso)
  return {
    day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    // "8:00", "13:30": a short 24-hour time with no leading zero.
    time: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
  }
}

// The meetings of the followed committees in the next 30 days. During the
// interim, these meetings are the main activity, so the list is in the
// primary column.
export function ComingUp({ upcoming }: { upcoming: LoadState<UpcomingMeetings> }) {
  if (upcoming.status === 'loading') {
    return (
      <section className={styles.card} aria-label="Coming up">
        <div className={styles.head}>
          <span className="eyebrow">Coming up</span>
          <span className={styles.headRight}>Next 30 days</span>
        </div>
        <div style={{ padding: 16 }}>
          <div className="skeleton" style={{ height: 40 }} />
        </div>
      </section>
    )
  }
  const meetings = upcoming.status === 'ready' ? upcoming.data.meetings : []
  const idle = upcoming.status === 'ready' ? upcoming.data.idleFollowedCount : 0
  const followsNone = meetings.length === 0 && idle === 0

  return (
    <section className={styles.card} aria-label="Coming up">
      <div className={styles.head}>
        <span className="eyebrow">Coming up</span>
        <span className={styles.headRight}>Next 30 days</span>
      </div>

      {meetings.length === 0 && (
        <div className={styles.empty}>
          {followsNone
            ? 'Follow an interim committee to see its meetings here.'
            : 'No followed committees meet in the next 30 days.'}
        </div>
      )}

      {meetings.map((m) => {
        const when = dateParts(m.datetime)
        const badge =
          m.trackedBillIds.length > 0 ? plural(m.trackedBillIds.length, 'tracked bill') : (m.watchSubjects[0] ?? null)
        return (
          <div key={m.id} className={styles.row}>
            <div className={styles.dateBlock}>
              <div className={styles.dateDay}>{when.day}</div>
              <div className={styles.dateTime}>
                {when.weekday} · {when.time}
              </div>
            </div>
            <div className={styles.rowMain}>
              <Link className={styles.committee} to={`/committees/${m.committeeId}`}>
                {m.committee}
              </Link>
              {m.location && <div className={styles.hint}>{m.location}</div>}
            </div>
            {badge && <span className={styles.badge}>{badge}</span>}
          </div>
        )
      })}

      {meetings.length > 0 && idle > 0 ? (
        <Link className={styles.footerLink} to="/committees">
          + {plural(idle, 'followed committee')} with nothing scheduled
        </Link>
      ) : meetings.length === 0 ? (
        <Link className={styles.footerLink} to="/committees">
          Browse committees →
        </Link>
      ) : null}
    </section>
  )
}
