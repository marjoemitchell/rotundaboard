import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import * as client from '../../data/client'
import type { Hearing, HearingSummary, LoadState } from '../../types'
import { formatClock, formatDate, formatDuration, formatTime } from '../../lib/format'
import { transcriptStatusLabel } from '../../lib/hearings'
import { useHearingPlayer } from '../../hooks/useHearingPlayer'
import { EmptyState } from '../shared/EmptyState'
import { HearingPlayerBar } from '../shared/HearingPlayerBar'
import styles from './HearingAudio.module.css'

export interface ClipPayload {
  hearingId: string
  startSeconds: number
  endSeconds: number
  text: string
  speaker: string | null
}

export function HearingAudio({
  hearings,
  onOpenTranscript,
  onClipToNotes,
}: {
  hearings: LoadState<HearingSummary[]>
  onOpenTranscript: (hearingId: string) => void
  onClipToNotes: (clip: ClipPayload, hearing: HearingSummary) => void
}) {
  const latest = hearings.status === 'ready' ? hearings.data[0] : null
  const [detail, setDetail] = useState<LoadState<Hearing>>({ status: 'loading' })

  useEffect(() => {
    if (!latest) return
    let cancelled = false
    setDetail({ status: 'loading' })
    client
      .getHearing(latest.id)
      .then((d) => !cancelled && setDetail({ status: 'ready', data: d }))
      .catch(() => !cancelled && setDetail({ status: 'empty' }))
    return () => {
      cancelled = true
    }
  }, [latest?.id])

  if (hearings.status === 'loading' || (latest && detail.status === 'loading')) {
    return (
      <div className={styles.card}>
        <div className="skeleton" style={{ height: 14, width: '60%' }} />
        <div className="skeleton" style={{ height: 32, marginTop: 14 }} />
        <div className="skeleton" style={{ height: 40, marginTop: 14 }} />
      </div>
    )
  }

  if (!latest || detail.status !== 'ready') {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <div className="eyebrow">Hearing audio</div>
        </div>
        <EmptyState message="No hearings recorded yet." />
      </div>
    )
  }

  return <HearingPlayer hearing={detail.data} onOpenTranscript={onOpenTranscript} onClipToNotes={onClipToNotes} />
}

function HearingPlayer({
  hearing,
  onOpenTranscript,
  onClipToNotes,
}: {
  hearing: Hearing
  onOpenTranscript: (hearingId: string) => void
  onClipToNotes: (clip: ClipPayload, hearing: HearingSummary) => void
}) {
  const player = useHearingPlayer(hearing.audioUrl, hearing.durationSeconds)
  const { currentTime, toggle, seek } = player
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery('')
  }, [hearing.id])

  const activeIndex = useMemo(() => {
    let candidate = -1
    for (let i = 0; i < hearing.transcript.length; i += 1) {
      if (hearing.transcript[i].timestamp <= currentTime) candidate = i
      else break
    }
    return candidate === -1 && hearing.transcript.length > 0 ? 0 : candidate
  }, [hearing.transcript, currentTime])
  const activeSegment = activeIndex >= 0 ? hearing.transcript[activeIndex] : undefined

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toLowerCase()
    return hearing.transcript.filter((seg) => seg.text.toLowerCase().includes(q))
  }, [hearing.transcript, query])

  const jumpToMatch = (index: number) => {
    if (matches.length === 0) return
    const wrapped = ((index % matches.length) + matches.length) % matches.length
    setMatchIndex(wrapped)
    seek(matches[wrapped].timestamp)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && e.target === containerRef.current) {
      e.preventDefault()
      toggle()
    }
  }

  const handleClip = () => {
    if (!activeSegment) return
    onClipToNotes(
      {
        hearingId: hearing.id,
        startSeconds: activeSegment.timestamp,
        endSeconds: activeSegment.endTimestamp,
        text: activeSegment.text,
        speaker: activeSegment.speaker,
      },
      hearing,
    )
  }

  const hasTranscript = hearing.transcript.length > 0

  return (
    <div
      className={styles.card}
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={`${hearing.committee} hearing audio player`}
    >
      <div className={styles.head}>
        <div className="eyebrow">Hearing audio</div>
        <div className={styles.committee}>{hearing.committee}</div>
      </div>
      <div className={styles.meta}>
        {formatDate(hearing.datetime)}, {formatTime(hearing.datetime)}
        {hearing.room ? ` · ${hearing.room}` : ''}
        {hearing.durationSeconds > 0 ? ` · ${formatDuration(hearing.durationSeconds)}` : ''}
      </div>
      <div className={styles.transcriptStatus} data-status={hearing.transcriptStatus}>
        {transcriptStatusLabel(hearing)}
      </div>

      {hasTranscript && (
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            placeholder="Search transcript"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setMatchIndex(0)
            }}
          />
          {query.trim() && (
            <>
              <span className={styles.searchCount}>{matches.length ? `${matchIndex + 1}/${matches.length}` : '0'}</span>
              <div className={styles.searchNav}>
                <button className={styles.searchNavButton} onClick={() => jumpToMatch(matchIndex - 1)} aria-label="Previous match">
                  ‹
                </button>
                <button className={styles.searchNavButton} onClick={() => jumpToMatch(matchIndex + 1)} aria-label="Next match">
                  ›
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {hearing.audioUrl && (
        <div className={styles.playerWrap}>
          <HearingPlayerBar
            player={player}
            durationSeconds={hearing.durationSeconds}
            waveform={hearing.waveform}
            markers={matches.map((m) => m.timestamp)}
          />
          {player.error && <div className={styles.playerError}>{player.error}</div>}
        </div>
      )}

      {activeSegment && (
        <div className={styles.excerpt}>
          <div className={styles.excerptHead}>
            <span>{formatClock(activeSegment.timestamp)}</span>
            {activeSegment.speaker && <span className={styles.excerptSpeaker}>{activeSegment.speaker}</span>}
          </div>
          <p className={styles.excerptText}>{activeSegment.text}</p>
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.actionButton} onClick={() => onOpenTranscript(hearing.id)}>
          Full transcript
        </button>
        {activeSegment && (
          <button className={styles.actionButton} onClick={handleClip}>
            Clip → notes
          </button>
        )}
        {hearing.trackedTermMentions > 0 && (
          <span className={styles.mentions}>
            {hearing.trackedTermMentions} tracked-bill mention{hearing.trackedTermMentions === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}
