import type { LoadState, SessionCalendar } from '../types'
import { formatDate, formatOrdinal } from '../lib/format'
import styles from './SessionClockStrip.module.css'

function Cell({
  label,
  value,
  unit,
  context,
}: {
  label: string
  value: number | null
  unit: string
  context: string
}) {
  return (
    <div className={styles.cell}>
      <div className="eyebrow">{label}</div>
      <div className={styles.value}>
        {value ?? '—'}
        {value !== null && <span className={styles.unit}>{unit}</span>}
      </div>
      <div className={styles.context}>{context}</div>
    </div>
  )
}

function SkeletonCell({ label }: { label: string }) {
  return (
    <div className={styles.cell}>
      <div className="eyebrow">{label}</div>
      <div className={`skeleton ${styles.skeletonValue}`} />
      <div className={`skeleton ${styles.skeletonContext}`} />
    </div>
  )
}

export function SessionClockStrip({ calendar }: { calendar: LoadState<SessionCalendar> }) {
  if (calendar.status === 'loading') {
    return (
      <div className={styles.strip}>
        <SkeletonCell label="Days to convene" />
        <SkeletonCell label="LC drafts filed" />
        <SkeletonCell label="Hearings, next 30 days" />
        <SkeletonCell label="Days to transmittal" />
      </div>
    )
  }

  if (calendar.status === 'empty') {
    return null
  }

  const c = calendar.data

  return (
    <div className={styles.strip}>
      <Cell
        label="Days to convene"
        value={c.daysToConvene}
        unit="days"
        context={
          c.sessionNumber && c.convenesOn
            ? `${formatOrdinal(c.sessionNumber)} Session · ${formatDate(c.convenesOn)}`
            : 'No upcoming session on the calendar yet'
        }
      />
      <Cell
        label="LC drafts filed"
        value={c.lcDraftsFiled}
        unit="filed"
        context={
          c.draftRequestDeadline
            ? `+${c.lcDraftsDelta7d} this week · requests due ${formatDate(c.draftRequestDeadline)}`
            : `+${c.lcDraftsDelta7d} this week`
        }
      />
      <Cell
        label="Hearings, next 30 days"
        value={c.hearingsNext30Days}
        unit="scheduled"
        context={c.hearingCommittees.length > 0 ? c.hearingCommittees.join(' · ') : 'None scheduled'}
      />
      <Cell
        label="Days to transmittal"
        value={c.daysToTransmittal}
        unit="days"
        context={c.transmittalDate ? formatDate(c.transmittalDate) : 'Not in session'}
      />
    </div>
  )
}
