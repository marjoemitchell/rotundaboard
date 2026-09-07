import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, NonStandingCommittee } from '../types'
import { formatDate, formatTime } from '../lib/format'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './CommitteesPage.module.css'

export function CommitteesPage() {
  const [committees, setCommittees] = useState<LoadState<NonStandingCommittee[]>>({ status: 'loading' })
  const [query, setQuery] = useState('')

  const load = () => {
    client
      .getCommittees()
      .then((data) => setCommittees(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setCommittees({ status: 'empty' }))
  }

  useEffect(load, [])

  const filtered = useMemo(() => {
    if (committees.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    if (!q) return committees.data
    return committees.data.filter((c) => c.name.toLowerCase().includes(q))
  }, [committees, query])

  const handleToggleFollow = async (c: NonStandingCommittee) => {
    if (c.isFollowed) await client.unfollowCommittee(c.id)
    else await client.followCommittee(c.id)
    load()
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Interim committees</h1>
      <p className={styles.subhead}>
        Legislative work between sessions happens here — study committees, budget committees, and administrative
        rules review, running year-round. Follow a committee to see its next meeting on your dashboard.
      </p>

      {committees.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
      {committees.status === 'empty' && <EmptyState message="No interim committees found." />}

      {committees.status === 'ready' && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              placeholder="Search committees"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.resultCount}>
              {filtered.length.toLocaleString()} of {committees.data.length.toLocaleString()} committees
            </div>
          </div>

          <div className={styles.list}>
            {filtered.map((c) => (
              <div key={c.id} className={styles.row}>
                <Link to={`/committees/${c.id}`} className={styles.rowMain}>
                  <div className={styles.rowName}>{c.name}</div>
                  <div className={styles.rowMeta}>
                    {c.committeeType ?? 'Committee'} · {c.memberCount} members
                    {c.nextMeetingAt
                      ? ` · Next: ${formatDate(c.nextMeetingAt)} ${formatTime(c.nextMeetingAt)}`
                      : ' · No upcoming meeting scheduled'}
                  </div>
                </Link>
                <button
                  className={`${styles.followButton} ${c.isFollowed ? styles.followButtonActive : ''}`}
                  onClick={() => handleToggleFollow(c)}
                >
                  {c.isFollowed ? 'Following' : '+ Follow'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
