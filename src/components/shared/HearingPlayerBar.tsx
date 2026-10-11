import type { MouseEvent } from 'react'
import type { HearingPlayer } from '../../hooks/useHearingPlayer'
import { formatClock } from '../../lib/format'
import styles from './HearingPlayerBar.module.css'

// Play button + seek bar + clock for a hearing recording. The seek bar is
// the recording's loudness waveform once the transcription pipeline has
// computed one, and a plain progress track until then. `markers` are
// positions (seconds) to tick above the bar, e.g. search hits.
export function HearingPlayerBar({
  player,
  durationSeconds,
  waveform,
  markers = [],
}: {
  player: HearingPlayer
  durationSeconds: number
  waveform: number[]
  markers?: number[]
}) {
  const { currentTime, isPlaying, toggle, seek } = player
  const playedRatio = durationSeconds > 0 ? Math.min(1, currentTime / durationSeconds) : 0

  const handleSeek = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    seek(((e.clientX - rect.left) / rect.width) * durationSeconds)
  }

  return (
    <div className={styles.playerRow}>
      <button className={styles.playButton} onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? '❚❚' : '▶'}
      </button>
      <div
        className={styles.track}
        onClick={handleSeek}
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(currentTime)}
        aria-valuemin={0}
        aria-valuemax={durationSeconds}
      >
        {waveform.length > 0 ? (
          waveform.map((amp, i) => (
            <span
              key={i}
              className={`${styles.waveformBar} ${i / waveform.length <= playedRatio ? styles.waveformBarPlayed : ''}`}
              style={{ height: `${Math.max(amp * 100, 12)}%` }}
            />
          ))
        ) : (
          <span className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${playedRatio * 100}%` }} />
          </span>
        )}
        {durationSeconds > 0 &&
          markers.map((t, i) => (
            <span key={i} className={styles.hitMark} style={{ left: `${(t / durationSeconds) * 100}%` }} />
          ))}
      </div>
      <span className={styles.elapsed} data-testid="player-clock">
        {formatClock(currentTime)} / {formatClock(durationSeconds)}
      </span>
    </div>
  )
}
