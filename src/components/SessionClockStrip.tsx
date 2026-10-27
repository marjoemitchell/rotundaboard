import type { LoadState, SessionCalendar } from '../types'
import { formatCalendarDate, formatDate, formatOrdinal } from '../lib/format'
import styles from './SessionClockStrip.module.css'

function Cell({
  label,
  value,
  unit,
  context,
  detail,
}: {
  label: string
  value: number | null
  unit: string
  context: string
  /** A second line of context, for example the later deadlines. */
  detail?: string
}) {
  return (
    <div className={styles.cell}>
      <div className="eyebrow">{label}</div>
      <div className={styles.value}>
        {value ?? '—'}
        {value !== null && <span className={styles.unit}>{unit}</span>}
      </div>
      <div className={styles.context}>{context}</div>
      {detail && <div className={styles.detail}>{detail}</div>}
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

/** Joins the parts that have text with " · ". An empty part gets no separator. */
function joinParts(parts: (string | null)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(' · ')
}

// The next transmittal deadline.
function transmittalContext(c: SessionCalendar): string {
  if (c.transmittalsPassed) return 'All transmittal deadlines have passed'
  if (!c.transmittalDate || !c.transmittalLabel) return 'Date not set yet'
  return `${c.transmittalLabel} · ${formatCalendarDate(c.transmittalDate, { weekday: true })}`
}

// The later transmittal deadlines, with a short date, on a second line.
function laterTransmittals(c: SessionCalendar): string | undefined {
  if (c.laterTransmittals.length === 0) return undefined
  return `Then ${c.laterTransmittals
    .map((d) => `${d.label.replace(/ bills$/, '').toLowerCase()} ${formatCalendarDate(d.date, { year: false })}`)
    .join(', ')}`
}

export function SessionClockStrip({ calendar }: { calendar: LoadState<SessionCalendar> }) {
  if (calendar.status === 'loading') {
    return (
      <div className={styles.strip}>
        <SkeletonCell label="Days to convene" />
        <SkeletonCell label="LC drafts tracked" />
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
        unit={c.daysToConvene === 1 ? 'day' : 'days'}
        context={
          c.sessionNumber && c.convenesOn
            ? `${formatOrdinal(c.sessionNumber)} Session · ${formatDate(c.convenesOn)}`
            : 'No upcoming session on the calendar yet'
        }
      />
      {/* Only the drafts that the team tracks, not all drafts statewide. A zero
          shows as "—" with the reason in words, not as a bare 0. */}
      <Cell
        label="LC drafts tracked"
        value={c.lcDraftsFiled > 0 ? c.lcDraftsFiled : null}
        unit={c.lcDraftsFiled === 1 ? 'draft' : 'drafts'}
        context={joinParts([
          c.lcDraftsFiled === 0 ? 'None tracked yet' : null,
          c.lcDraftsDelta7d > 0 ? `+${c.lcDraftsDelta7d} this week` : null,
          c.draftRequestDeadline ? `requests due ${formatDate(c.draftRequestDeadline)}` : null,
        ])}
      />
      {/* Only the committees that the team follows. */}
      <Cell
        label="Hearings, next 30 days"
        value={c.hearingsNext30Days > 0 ? c.hearingsNext30Days : null}
        unit="scheduled"
        context={
          c.hearingsNext30Days > 0
            ? c.hearingCommittees.join(' · ')
            : 'None for committees that you follow'
        }
      />
      <Cell
        label="Days to transmittal"
        value={c.daysToTransmittal}
        unit={c.daysToTransmittal === 1 ? 'day' : 'days'}
        context={transmittalContext(c)}
        detail={laterTransmittals(c)}
      />
    </div>
  )
}
