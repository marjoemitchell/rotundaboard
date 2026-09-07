import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LegislativeSession, LoadState } from '../types'
import { formatDate, formatOrdinal } from '../lib/format'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './SessionsPage.module.css'

const STATUS_LABEL: Record<LegislativeSession['status'], string> = {
  active: 'In session',
  upcoming: 'Upcoming',
  past: 'Concluded',
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<LoadState<LegislativeSession[]>>({ status: 'loading' })

  useEffect(() => {
    client
      .getSessions()
      .then((data) => setSessions(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setSessions({ status: 'empty' }))
  }, [])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Sessions</h1>
      <p className={styles.subhead}>
        Every session we have data for — browse any bill, not just the ones your team is tracking.
      </p>

      {sessions.status === 'loading' && <div className="skeleton" style={{ height: 200 }} />}
      {sessions.status === 'empty' && <EmptyState message="No sessions found." />}

      {sessions.status === 'ready' && (
        <div className={styles.list}>
          {sessions.data.map((s) => (
            <Link key={s.id} to={`/sessions/${s.id}`} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.ordinal}>{formatOrdinal(s.legislatureOrdinal)} Legislature</span>
                <span className={`${styles.statusBadge} ${styles[s.status]}`}>{STATUS_LABEL[s.status]}</span>
              </div>
              <div className={styles.dates}>
                {s.startDate ? formatDate(s.startDate) : 'Date TBD'}
                {s.sineDieDate ? ` – ${formatDate(s.sineDieDate)}` : ''}
              </div>
              <div className={styles.counts}>
                <span>
                  <strong>{s.billCount.toLocaleString()}</strong> bills
                </span>
                <span>
                  <strong>{s.trackedCount}</strong> tracked
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
