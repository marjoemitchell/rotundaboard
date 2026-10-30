import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { HearingSummary, LoadState, UpcomingHearing } from '../types'
import { formatDate, formatDuration, formatTime } from '../lib/format'
import { transcriptStatusLabel } from '../lib/hearings'
import { RecordingsNote } from '../components/shared/RecordingsNote'
import { EmptyState } from '../components/shared/EmptyState'
import { SignupGate } from '../components/shared/SignupGate'
import { usePublicView } from '../lib/publicView'
import styles from './HearingsPage.module.css'

const RECORDINGS_PREVIEW = 8

// A recent recording. A visitor gets a signup popover, because the audio and
// the transcript need an account. After signup, the recording opens.
function RecordingRow({ recording, isPublic, children }: { recording: HearingSummary; isPublic: boolean; children: ReactNode }) {
  const className = `${styles.recording} ${recording.isFollowed ? styles.recordingFollowed : ''}`
  if (isPublic) {
    return (
      <SignupGate
        action="listen to this recording"
        reason="You can read and search its transcript."
        returnTo={`/hearings/recordings/${recording.id}`}
        block
        className={className}
      >
        {children}
      </SignupGate>
    )
  }
  return (
    <Link to={`/hearings/recordings/${recording.id}`} className={className}>
      {children}
    </Link>
  )
}

export function HearingsPage() {
  const [hearings, setHearings] = useState<LoadState<UpcomingHearing[]>>({ status: 'loading' })
  const [recordings, setRecordings] = useState<HearingSummary[]>([])
  const [query, setQuery] = useState('')
  const [showAllRecordings, setShowAllRecordings] = useState(false)
  // A visitor sees the recordings, but the audio and the transcript need an account.
  const isPublic = usePublicView()

  useEffect(() => {
    ;(isPublic ? client.getPublicUpcomingHearings() : client.getUpcomingHearings())
      .then((data) => setHearings(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setHearings({ status: 'empty' }))
    ;(isPublic ? client.getPublicHearings() : client.getHearings())
      .then(setRecordings)
      .catch(() => setRecordings([]))
  }, [isPublic])

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
        {isPublic
          ? 'These are all the scheduled interim committee hearings. Click a hearing to see the agenda of its committee.'
          : `These are all the scheduled interim committee hearings, for all committees, not only the committees that
        you follow. Click a hearing to see the agenda of its committee. Open a recent recording to read and search its
        transcript.`}
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
          {isPublic && (
            <p className={styles.publicNote}>Sign up free to listen to a recording and read its transcript.</p>
          )}
          <RecordingsNote />
          <div className={styles.list}>
            {(showAllRecordings ? filteredRecordings : filteredRecordings.slice(0, RECORDINGS_PREVIEW)).map((r) => (
              <RecordingRow key={r.id} recording={r} isPublic={isPublic}>
                <span className={styles.rowDate}>
                  <span className={styles.rowDateDay}>{formatDate(r.datetime)}</span>
                  <span className={styles.recordingTime}>{formatTime(r.datetime)}</span>
                </span>
                <span className={styles.rowMain}>
                  <span className={styles.recordingCommittee}>{r.committee}</span>
                  <span className={styles.recordingStatus} data-status={r.transcriptStatus}>
                    {transcriptStatusLabel(r)}
                  </span>
                </span>
                <span className={styles.rowAgenda}>{r.durationSeconds > 0 ? formatDuration(r.durationSeconds) : ''}</span>
              </RecordingRow>
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
