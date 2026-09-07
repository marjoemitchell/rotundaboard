import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../../data/client'
import type { FollowedCommittee, LoadState } from '../../types'
import { formatDate, formatTime } from '../../lib/format'
import { EmptyState } from '../shared/EmptyState'
import styles from './FollowedCommittees.module.css'

export function FollowedCommittees() {
  const [committees, setCommittees] = useState<LoadState<FollowedCommittee[]>>({ status: 'loading' })

  useEffect(() => {
    client
      .getFollowedCommittees()
      .then((data) => setCommittees(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setCommittees({ status: 'empty' }))
  }, [])

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className="eyebrow">Interim committees</span>
        <Link className={styles.openLink} to="/committees">
          Browse all
        </Link>
      </div>

      {committees.status === 'loading' && <div className="skeleton" style={{ height: 60 }} />}
      {committees.status === 'empty' && (
        <EmptyState message="Not following any committees yet — follow one to see its next meeting here, year-round." />
      )}
      {committees.status === 'ready' && (
        <div className={styles.list}>
          {committees.data.map((c) => (
            <Link key={c.id} to={`/committees/${c.id}`} className={styles.item}>
              <div className={styles.itemName}>{c.name}</div>
              <div className={styles.itemMeta}>
                {c.nextMeetingAt
                  ? `Next: ${formatDate(c.nextMeetingAt)}, ${formatTime(c.nextMeetingAt)}${c.nextLocation ? ` · ${c.nextLocation}` : ''}`
                  : 'No upcoming meeting scheduled'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
