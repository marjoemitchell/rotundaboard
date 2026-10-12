import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { HearingSummary, LoadState, UpcomingHearing } from '../types'
import { formatDate, formatDuration, formatTime } from '../lib/format'
import { transcriptStatusLabel } from '../lib/hearings'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './HearingsPage.module.css'

const RECORDINGS_PREVIEW = 8

export function HearingsPage() {
  const [hearings, setHearings] = useState<LoadState<UpcomingHearing[]>>({ status: 'loading' })
  const [recordings, setRecordings] = useState<HearingSummary[]>([])
  const [query, setQuery] = useState('')
  const [showAllRecordings, setShowAllRecordings] = useState(false)

  useEffect(() => {
    client
      .getUpcomingHearings()
      .then((data) => setHearings(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setHearings({ status: 'empty' }))
    client
      .getHearings()
      .then(setRecordings)
      .catch(() => setRecordings([]))
  }, [])

  const filtered = useMemo(() => {
    if (hearings.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    if (!q) return hearings.data
    return hearings.data.filter((h) => h.committee.toLowerCase().includes(q))
  }, [hearings, query])

  const filteredRecordings = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? recordings.filter((r) => r.committee.toLowerCase().includes(q)) : recordings
  }, [recordings, query])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Hearings</h1>
      <p className={styles.subhead}>
        These are all the scheduled interim committee hearings, for all committees, not only the committees that you
        follow. Click a hearing to see the agenda of its committee. Open a recent recording to read and search its
        transcript.
      </p>

      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          placeholder="Search by committee"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filteredRecordings.length > 0 && (
        <section className={styles.section} aria-label="Recent recordings">
          <h2 className={styles.sectionTitle}>Recent recordings</h2>
          <div className={styles.list}>
            {(showAllRecordings ? filteredRecordings : filteredRecordings.slice(0, RECORDINGS_PREVIEW)).map((r) => (
              <Link
                key={r.id}
                to={`/hearings/recordings/${r.id}`}
                className={`${styles.recording} ${r.isFollowed ? styles.recordingFollowed : ''}`}
              >
                <div className={styles.rowDate}>
                  <div className={styles.rowDateDay}>{formatDate(r.datetime)}</div>
                  <div className={styles.recordingTime}>{formatTime(r.datetime)}</div>
                </div>
                <div className={styles.rowMain}>
                  <div className={styles.recordingCommittee}>{r.committee}</div>
                  <div className={styles.recordingStatus} data-status={r.transcriptStatus}>
                    {transcriptStatusLabel(r)}
                  </div>
                </div>
                <div className={styles.rowAgenda}>{r.durationSeconds > 0 ? formatDuration(r.durationSeconds) : ''}</div>
              </Link>
            ))}
          </div>
          {filteredRecordings.length > RECORDINGS_PREVIEW && (
            <button className={styles.showAll} onClick={() => setShowAllRecordings((v) => !v)}>
              {showAllRecordings ? 'Show fewer' : `Show all ${filteredRecordings.length} recent recordings`}
            </button>
          )}
        </section>
      )}

      <h2 className={styles.sectionTitle}>Upcoming</h2>
      {hearings.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
      {hearings.status === 'empty' && <EmptyState message="No hearings currently scheduled." />}

      {hearings.status === 'ready' && (
        <>
          <div className={styles.resultCount}>
            {filtered.length.toLocaleString()} of {hearings.data.length.toLocaleString()} hearings
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
