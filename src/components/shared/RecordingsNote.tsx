import { RECORDINGS_POLICY } from '../../lib/hearings'
import styles from './RecordingsNote.module.css'

// Tells the user which hearing recordings Rotunda Board keeps, and which of
// them get a full transcript. The original video is always on the
// Legislature's site.
export function RecordingsNote({ archiveUrl }: { archiveUrl?: string }) {
  const { findYears, fullTranscriptDays } = RECORDINGS_POLICY
  return (
    <details className={styles.note}>
      <summary className={styles.summary}>How we keep recordings</summary>
      <ul className={styles.list}>
        <li>
          We link the video of each interim committee meeting from the last {findYears} years. The video comes from the
          Legislature's video archive.
        </li>
        <li>
          Meetings from the last {fullTranscriptDays} days get a full transcript with speaker names and an AI summary.
        </li>
        <li>Older meetings have the Legislature's captions only, when the archive has them.</li>
        <li>
          The original video always stays on the Legislature's site.{' '}
          <a href={archiveUrl ?? 'https://streaming-video.legmt.gov/'} target="_blank" rel="noreferrer">
            {archiveUrl ? 'All videos of this committee ↗' : 'Open the video archive ↗'}
          </a>
        </li>
      </ul>
    </details>
  )
}
