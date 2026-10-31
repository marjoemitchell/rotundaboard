import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as client from '../data/client'
import type { Hearing, HearingAiSummary, LoadState } from '../types'
import { formatClock, formatDate, formatDuration, formatTime } from '../lib/format'
import { clipToNote, RECORDINGS_POLICY, transcriptStatusLabel } from '../lib/hearings'
import { useHearingPlayer } from '../hooks/useHearingPlayer'
import { EmptyState } from '../components/shared/EmptyState'
import { HearingPlayerBar } from '../components/shared/HearingPlayerBar'
import { Toast } from '../components/shared/Toast'
import { UpgradeNotice } from '../components/shared/UpgradeNotice'
import { usePlan } from '../auth/usePlan'
import styles from './HearingTranscriptPage.module.css'

export function HearingTranscriptPage() {
  const { id } = useParams<{ id: string }>()
  const [hearing, setHearing] = useState<LoadState<Hearing>>({ status: 'loading' })

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setHearing({ status: 'loading' })
    client
      .getHearing(id)
      .then((h) => !cancelled && setHearing({ status: 'ready', data: h }))
      .catch(() => !cancelled && setHearing({ status: 'empty' }))
    return () => {
      cancelled = true
    }
  }, [id])

  if (hearing.status === 'loading') {
    return (
      <div className={styles.page}>
        <div className="skeleton" style={{ height: 28, width: '50%' }} />
        <div className="skeleton" style={{ height: 300, marginTop: 16 }} />
      </div>
    )
  }
  if (hearing.status === 'empty') {
    return (
      <div className={styles.page}>
        <Link to="/hearings" className={styles.back}>
          ← Hearings
        </Link>
        <EmptyState message="This hearing recording couldn’t be found." />
      </div>
    )
  }
  return <Transcript hearing={hearing.data} />
}

function Transcript({ hearing }: { hearing: Hearing }) {
  // A plan without AI summaries gets a locked summary card on every recording.
  const canSeeSummary = usePlan().has('aiSummaries')
  const player = useHearingPlayer(hearing.audioUrl, hearing.durationSeconds)
  const { currentTime, isPlaying, seek } = player
  const [query, setQuery] = useState('')
  const [speakerFilter, setSpeakerFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const activeRowRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  const speakers = useMemo(
    () => [...new Set(hearing.transcript.map((s) => s.speaker).filter((s): s is string => !!s))].sort(),
    [hearing.transcript],
  )

  const activeIndex = useMemo(() => {
    let candidate = -1
    for (let i = 0; i < hearing.transcript.length; i += 1) {
      if (hearing.transcript[i].timestamp <= currentTime) candidate = i
      else break
    }
    return candidate
  }, [hearing.transcript, currentTime])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return hearing.transcript
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => (!q || segment.text.toLowerCase().includes(q)) && (!speakerFilter || segment.speaker === speakerFilter))
  }, [hearing.transcript, query, speakerFilter])

  // Follow along while playing — but never yank the page around while the
  // user is just browsing a paused transcript.
  useEffect(() => {
    if (isPlaying) activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex, isPlaying])

  const handleClip = async (index: number) => {
    const seg = hearing.transcript[index]
    try {
      await client.createNote(
        clipToNote({ startSeconds: seg.timestamp, endSeconds: seg.endTimestamp, text: seg.text, speaker: seg.speaker }, hearing),
      )
      setNotice(`Clipped ${formatClock(seg.timestamp)}–${formatClock(seg.endTimestamp)} to notes.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save this clip.')
    }
  }

  return (
    <div className={styles.page}>
      <Link to="/hearings" className={styles.back}>
        ← Hearings
      </Link>
      <h1 className={styles.title}>{hearing.committee}</h1>
      <p className={styles.subhead}>
        {formatDate(hearing.datetime)}, {formatTime(hearing.datetime)}
        {hearing.room ? ` · ${hearing.room}` : ''}
        {hearing.durationSeconds > 0 ? ` · ${formatDuration(hearing.durationSeconds)}` : ''}
      </p>
      <div className={styles.links}>
        <span className={styles.status} data-status={hearing.transcriptStatus}>
          {transcriptStatusLabel(hearing)}
        </span>
        {hearing.committeeId && <Link to={`/committees/${hearing.committeeId}`}>Committee page</Link>}
        <a href={hearing.sourceUrl} target="_blank" rel="noreferrer">
          Watch on the Legislature’s archive ↗
        </a>
      </div>

      {hearing.audioUrl && (
        <div className={styles.playerCard}>
          <HearingPlayerBar
            player={player}
            durationSeconds={hearing.durationSeconds}
            waveform={hearing.waveform}
            markers={query.trim() ? visible.map((v) => v.segment.timestamp) : []}
          />
          {player.error && <div className={styles.playerError}>{player.error}</div>}
        </div>
      )}

      {hearing.transcriptSource === 'captions' && (
        <p className={styles.captionNotice}>
          These are the Legislature’s live captions: incomplete, unpunctuated, and without speaker names.{' '}
          {hearing.fullTranscript
            ? 'A full, speaker-attributed transcript replaces them once processing finishes.'
            : `This meeting is older than ${RECORDINGS_POLICY.fullTranscriptDays} days, so it keeps the captions only.`}
        </p>
      )}

      {hearing.aiSummary && <AiSummaryCard summary={hearing.aiSummary} onSeek={(t) => seek(t, { play: true })} />}
      {!canSeeSummary && <LockedSummaryCard teaser={hearing.aiSummaryTeaser} />}

      {hearing.transcript.length === 0 ? (
        <EmptyState
          message={
            hearing.fullTranscript
              ? 'The transcript for this hearing is still being prepared. Check back soon.'
              : `This meeting is older than ${RECORDINGS_POLICY.fullTranscriptDays} days and the Legislature posted no captions for it, so it has no transcript. The video is on the Legislature's site.`
          }
        />
      ) : (
        <>
          <div className={styles.toolbar}>
            <input
              className={styles.searchInput}
              placeholder="Search transcript"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {speakers.length > 0 && (
              <select
                className={styles.speakerSelect}
                value={speakerFilter}
                onChange={(e) => setSpeakerFilter(e.target.value)}
                aria-label="Filter by speaker"
              >
                <option value="">All speakers</option>
                {speakers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <span className={styles.count}>
              {visible.length.toLocaleString()} of {hearing.transcript.length.toLocaleString()} lines
            </span>
          </div>

          <ol className={styles.lines} aria-label="Transcript">
            {visible.map(({ segment, index }) => {
              const active = index === activeIndex
              return (
                <li
                  key={index}
                  ref={active ? activeRowRef : undefined}
                  className={`${styles.line} ${active ? styles.lineActive : ''}`}
                  aria-current={active ? 'true' : undefined}
                >
                  <button
                    className={styles.lineBody}
                    onClick={() => seek(segment.timestamp, { play: true })}
                    title="Play from here"
                  >
                    <span className={styles.lineTime}>{formatClock(segment.timestamp)}</span>
                    <span className={styles.lineMain}>
                      {segment.speaker && <span className={styles.lineSpeaker}>{segment.speaker}</span>}
                      <span className={styles.lineText}>{segment.text}</span>
                      {segment.mentionedBillIds.length > 0 && (
                        <span className={styles.mentionTag}>Mentions a tracked bill</span>
                      )}
                    </span>
                  </button>
                  <button className={styles.clipButton} onClick={() => handleClip(index)} aria-label={`Clip ${formatClock(segment.timestamp)} to notes`}>
                    Clip
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}

      {notice && <Toast message={notice} />}
    </div>
  )
}

// The plan of the workspace does not include AI summaries. The card shows on
// every recording, so that the free plan is the same on each page:
//   - With a summary, it shows the first sentence and the upgrade notice.
//   - Without a summary (not made yet), it shows only the upgrade notice.
function LockedSummaryCard({ teaser }: { teaser: string | null }) {
  return (
    <section className={styles.summaryCard} aria-label="Summary">
      <div className={styles.summaryHead}>
        <h2 className={styles.summaryTitle}>Summary</h2>
        {teaser && <span className={styles.summaryBadge}>AI-generated</span>}
      </div>
      {teaser && <p className={styles.summaryOverview}>{teaser}</p>}
      <UpgradeNotice
        message={
          teaser
            ? 'The full AI summary, with the topics, the actions, and links to each part of the recording, is included in the paid plans.'
            : 'AI summaries of hearings, with the topics, the actions, and links to each part of the recording, are included in the paid plans.'
        }
      />
    </section>
  )
}

// The AI summary of the transcript. A time button plays the recording from
// the start of that topic.

function AiSummaryCard({ summary, onSeek }: { summary: HearingAiSummary; onSeek: (seconds: number) => void }) {
  // A column of the same width for each item, also when it has no time.
  const time = (seconds: number | null) => (
    <span className={styles.summaryTimeCell}>
      {seconds != null && (
        <button className={styles.summaryTime} onClick={() => onSeek(seconds)} title="Play from here">
          {formatClock(seconds)}
        </button>
      )}
    </span>
  )
  return (
    <section className={styles.summaryCard} aria-label="Summary">
      <div className={styles.summaryHead}>
        <h2 className={styles.summaryTitle}>Summary</h2>
        <span className={styles.summaryBadge}>AI-generated</span>
      </div>
      <p className={styles.summaryOverview}>{summary.overview}</p>

      {summary.topics.length > 0 && (
        <>
          <h3 className={styles.summarySubhead}>Topics</h3>
          <ol className={styles.summaryList} aria-label="Topics">
            {summary.topics.map((t, i) => (
              <li key={i} className={styles.summaryItem}>
                {time(t.startSeconds)}
                <div>
                  <div className={styles.summaryItemTitle}>{t.title}</div>
                  <div className={styles.summaryItemText}>{t.summary}</div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {summary.actions.length > 0 && (
        <>
          <h3 className={styles.summarySubhead}>Decisions and next steps</h3>
          <ul className={styles.summaryList} aria-label="Decisions and next steps">
            {summary.actions.map((a, i) => (
              <li key={i} className={styles.summaryItem}>
                {time(a.startSeconds)}
                <div className={styles.summaryItemText}>{a.text}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={styles.summaryNote}>
        Generated from the transcript, which can have speech recognition errors. Verify against the recording.
      </p>
    </section>
  )
}
