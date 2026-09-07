import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, UpcomingHearing } from '../types'
import { formatDate, formatTime } from '../lib/format'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './HearingsPage.module.css'

export function HearingsPage() {
  const [hearings, setHearings] = useState<LoadState<UpcomingHearing[]>>({ status: 'loading' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    client
      .getUpcomingHearings()
      .then((data) => setHearings(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setHearings({ status: 'empty' }))
  }, [])

  const filtered = useMemo(() => {
    if (hearings.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    if (!q) return hearings.data
    return hearings.data.filter((h) => h.committee.toLowerCase().includes(q))
  }, [hearings, query])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Hearings</h1>
      <p className={styles.subhead}>
        Every scheduled interim committee hearing on record, across all committees — not just the ones you follow.
        Click one to see its committee's agenda.
      </p>

      {hearings.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
      {hearings.status === 'empty' && <EmptyState message="No hearings currently scheduled." />}

      {hearings.status === 'ready' && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              placeholder="Search by committee"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.resultCount}>
              {filtered.length.toLocaleString()} of {hearings.data.length.toLocaleString()} hearings
            </div>
          </div>

          <div className={styles.list}>
            {filtered.map((h) => (
              <Link
                key={h.id}
                to={`/committees/${h.committeeId}`}
                className={`${styles.row} ${h.isFollowed ? styles.rowFollowed : ''}`}
              >
                <div className={styles.rowDate}>
                  <div className={styles.rowDateDay}>{formatDate(h.meetingTime)}</div>
                  <div className={styles.rowDateTime}>{formatTime(h.meetingTime)}</div>
                </div>
                <div className={styles.rowMain}>
                  <div className={styles.rowCommitteeLine}>
                    <span className={styles.rowCommittee}>{h.committee}</span>
                    {h.isFollowed && <span className={styles.followingBadge}>Following</span>}
                  </div>
                  <div className={styles.rowMeta}>
                    {h.location?.trim() || 'Location TBD'}
                    {h.publicParticipation ? ' · Open to public comment' : ''}
                  </div>
                </div>
                <div className={styles.rowAgenda}>
                  {h.agendaCount > 0 ? `${h.agendaCount} agenda item${h.agendaCount === 1 ? '' : 's'}` : 'No agenda posted yet'}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
