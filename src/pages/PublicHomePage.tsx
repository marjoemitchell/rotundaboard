import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, UpcomingHearing } from '../types'
import { formatDate, formatTime } from '../lib/format'
import styles from './PublicHomePage.module.css'

// The number of upcoming hearings that the home page shows.
const HEARINGS_PREVIEW = 5

const BROWSE_LINKS = [
  {
    to: '/bills',
    title: 'Bills',
    text: 'Search the bills of each session by number, title, or sponsor.',
  },
  {
    to: '/legislators',
    title: 'Legislators',
    text: 'Find your legislators on the county map, or see the full list.',
  },
  {
    to: '/committees',
    title: 'Committees',
    text: 'See each interim committee, its meetings, and its agendas and materials.',
  },
  {
    to: '/hearings',
    title: 'Hearings',
    text: 'See the full schedule of upcoming committee hearings.',
  },
]

// The home page for a visitor without an account (PublicApp.tsx).
export function PublicHomePage() {
  const [hearings, setHearings] = useState<LoadState<UpcomingHearing[]>>({ status: 'loading' })
  const location = useLocation()

  useEffect(() => {
    client
      .getPublicUpcomingHearings()
      .then((data) =>
        setHearings(data.length === 0 ? { status: 'empty' } : { status: 'ready', data: data.slice(0, HEARINGS_PREVIEW) }),
      )
      .catch(() => setHearings({ status: 'empty' }))
  }, [])

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Follow the Montana Legislature</h1>
        <p className={styles.lead}>
          Look up your legislators, see what the interim committees are working on, and check the hearing schedule.
          You do not need an account.
        </p>
        <p className={styles.pitch}>
          With a free account, you can track a few bills on your own and set your position on each. Paid plans add
          your team, notes, testimony, and email alerts when a tracked bill has a hearing.
        </p>
        <div className={styles.ctas}>
          <Link to="/signup" state={{ from: location }} className={styles.primary}>
            Sign up free
          </Link>
          <Link to="/login" state={{ from: location }} className={styles.secondary}>
            Log in
          </Link>
        </div>
      </section>

      <section className={styles.section} aria-label="Browse">
        <h2 className={styles.sectionTitle}>Browse</h2>
        <div className={styles.cards}>
          {BROWSE_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className={styles.card}>
              <span className={styles.cardTitle}>{l.title}</span>
              <span className={styles.cardText}>{l.text}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-label="Upcoming hearings">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Upcoming hearings</h2>
          <Link to="/hearings" className={styles.seeAll}>
            See all hearings →
          </Link>
        </div>
        {hearings.status === 'loading' && <div className="skeleton" style={{ height: 240 }} />}
        {hearings.status === 'empty' && <p className={styles.empty}>No hearings are scheduled now.</p>}
        {hearings.status === 'ready' && (
          <div className={styles.list}>
            {hearings.data.map((h) => (
              <Link key={h.id} to={`/committees/${h.committeeId}`} className={styles.row}>
                <div className={styles.rowDate}>
                  <div className={styles.rowDateDay}>{formatDate(h.meetingTime)}</div>
                  <div className={styles.rowDateTime}>{formatTime(h.meetingTime)}</div>
                </div>
                <div className={styles.rowMain}>
                  <div className={styles.rowCommittee}>{h.committee}</div>
                  <div className={styles.rowMeta}>
                    {h.location?.trim() || 'Location TBD'}
                    {h.publicParticipation ? ' · Open to public comment' : ''}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
