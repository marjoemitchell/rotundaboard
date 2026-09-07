import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { Hearing, LoadState } from '../../types'
import { formatClock, formatDate, formatDuration, formatTime } from '../../lib/format'
import { EmptyState } from '../shared/EmptyState'
import styles from './HearingAudio.module.css'

export interface ClipPayload {
  hearingId: string
  startSeconds: number
  endSeconds: number
  text: string
}

export function HearingAudio({
  hearings,
  onOpenTranscript,
  onClipToNotes,
}: {
  hearings: LoadState<Hearing[]>
  onOpenTranscript: (hearingId: string) => void
  onClipToNotes: (clip: ClipPayload) => void
}) {
  if (hearings.status === 'loading') {
    return (
      <div className={styles.card}>
        <div className="skeleton" style={{ height: 14, width: '60%' }} />
        <div className="skeleton" style={{ height: 32, marginTop: 14 }} />
        <div className="skeleton" style={{ height: 40, marginTop: 14 }} />
      </div>
    )
  }

  if (hearings.status === 'empty') {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <div className="eyebrow">Hearing audio</div>
        </div>
        <EmptyState message="No hearings recorded yet." />
      </div>
    )
  }

  const hearing = hearings.data[0]
  return <HearingPlayer hearing={hearing} onOpenTranscript={onOpenTranscript} onClipToNotes={onClipToNotes} />
}

function HearingPlayer({
  hearing,
  onOpenTranscript,
  onClipToNotes,
}: {
  hearing: Hearing
  onOpenTranscript: (hearingId: string) => void
  onClipToNotes: (clip: ClipPayload) => void
}) {
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isPlaying) return
    const interval = setInterval(() => {
      setCurrentTime((t) => {
        if (t + 1 >= hearing.durationSeconds) {
          setIsPlaying(false)
          return hearing.durationSeconds
        }
        return t + 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isPlaying, hearing.durationSeconds])

  useEffect(() => {
    setCurrentTime(0)
    setIsPlaying(false)
    setQuery('')
  }, [hearing.id])

  const activeSegment = useMemo(() => {
    let candidate = hearing.transcript[0]
    for (const seg of hearing.transcript) {
      if (seg.timestamp <= currentTime) candidate = seg
    }
    return candidate
  }, [hearing.transcript, currentTime])

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toLowerCase()
    return hearing.transcript.filter((seg) => seg.text.toLowerCase().includes(q))
  }, [hearing.transcript, query])

  const seekTo = (seconds: number) => {
    setCurrentTime(Math.min(Math.max(seconds, 0), hearing.durationSeconds))
  }

  const handleWaveformClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    seekTo(ratio * hearing.durationSeconds)
  }

  const jumpToMatch = (index: number) => {
    if (matches.length === 0) return
    const wrapped = ((index % matches.length) + matches.length) % matches.length
    setMatchIndex(wrapped)
    seekTo(matches[wrapped].timestamp)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && e.target === containerRef.current) {
      e.preventDefault()
      setIsPlaying((p) => !p)
    }
  }

  const playedRatio = hearing.durationSeconds > 0 ? currentTime / hearing.durationSeconds : 0
  const hasRecording = hearing.waveform.length > 0

  const handleClip = () => {
    if (!activeSegment) return
    const idx = hearing.transcript.indexOf(activeSegment)
    const next = hearing.transcript[idx + 1]
    const endSeconds = next ? next.timestamp : hearing.durationSeconds
    onClipToNotes({
      hearingId: hearing.id,
      startSeconds: activeSegment.timestamp,
      endSeconds,
      text: activeSegment.text,
    })
  }

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
        {formatDate(hearing.datetime)}, {formatTime(hearing.datetime)} · {hearing.room}
        {hasRecording && (
          <>
            {' '}
            · {formatDuration(hearing.durationSeconds)} ·{' '}
            <span className={styles.transcriptStatus}>{hearing.transcriptStatus}</span> transcript
          </>
        )}
      </div>

      {!hasRecording && <EmptyState message="No recording is available for this hearing yet." />}

      {hasRecording && (
        <>
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
                <span className={styles.searchCount}>
                  {matches.length ? `${matchIndex + 1}/${matches.length}` : '0'}
                </span>
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

          <div className={styles.playerRow}>
            <button
              className={styles.playButton}
              onClick={() => setIsPlaying((p) => !p)}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <div className={styles.waveform} onClick={handleWaveformClick} role="slider" aria-label="Seek" aria-valuenow={Math.round(currentTime)} aria-valuemin={0} aria-valuemax={hearing.durationSeconds}>
              {hearing.waveform.map((amp, i) => {
                const barRatio = i / hearing.waveform.length
                return (
                  <span
                    key={i}
                    className={`${styles.waveformBar} ${barRatio <= playedRatio ? styles.waveformBarPlayed : ''}`}
                    style={{ height: `${Math.max(amp * 100, 12)}%` }}
                  />
                )
              })}
              {matches.map((seg, i) => (
                <span
                  key={i}
                  className={styles.hitMark}
                  style={{ left: `${(seg.timestamp / hearing.durationSeconds) * 100}%` }}
                />
              ))}
            </div>
            <span className={styles.elapsed}>
              {formatClock(currentTime)} / {formatClock(hearing.durationSeconds)}
            </span>
          </div>

          {activeSegment && (
            <div className={styles.excerpt}>
              <div className={styles.excerptHead}>
                <span>{formatClock(activeSegment.timestamp)}</span>
                <span className={styles.excerptSpeaker}>{activeSegment.speaker}</span>
              </div>
              <p className={styles.excerptText}>{activeSegment.text}</p>
            </div>
          )}

          <div className={styles.actions}>
            <button className={styles.actionButton} onClick={() => onOpenTranscript(hearing.id)}>
              Full transcript
            </button>
            <button className={styles.actionButton} onClick={handleClip}>
              Clip → notes
            </button>
            <button className={styles.actionButton}>{hearing.trackedTermMentions} tracked-term mentions</button>
          </div>
        </>
      )}
    </div>
  )
}
