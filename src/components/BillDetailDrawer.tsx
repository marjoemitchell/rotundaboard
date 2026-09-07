import { useEffect, useState } from 'react'
import type { TransitionEvent } from 'react'
import * as client from '../data/client'
import type { AiSummary, Bill, LoadState, Position, TeamMember } from '../types'
import { formatDate, formatSignedDelta } from '../lib/format'
import { InitialsSquare } from './shared/InitialsSquare'
import { Sparkline } from './shared/Sparkline'
import styles from './BillDetailDrawer.module.css'

const POSITION_OPTIONS: { value: NonNullable<Position>; label: string }[] = [
  { value: 'support', label: 'Support' },
  { value: 'oppose', label: 'Oppose' },
  { value: 'watch', label: 'Watch' },
  { value: 'neutral', label: 'Neutral' },
]

export function BillDetailDrawer({
  bill,
  assignee,
  teamMembers,
  onClose,
  onChangePosition,
  onChangeAssignee,
  onViewFullDetails,
}: {
  bill: Bill
  assignee: TeamMember | null
  teamMembers: LoadState<TeamMember[]>
  onClose: () => void
  onChangePosition: (position: Position) => void
  onChangeAssignee: (assigneeId: string | null) => void
  onViewFullDetails: () => void
}) {
  // Mounts closed (scaled down and faded out) and flips to open on the next
  // frame so the transition actually has something to animate from —
  // flipping the class in the same render as the initial mount would let
  // the browser paint the "open" state directly and skip the pop-in
  // entirely. Closing reverses this: onClose() only fires once the exit
  // transition finishes, so the parent doesn't unmount this component out
  // from under its own animation.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const handleClose = () => setVisible(false)

  // The drawer only ever gets the lightweight Bill the dashboard list
  // already has loaded — the AI summary lives on the fuller BillDetail
  // record, so it's fetched separately here rather than pulling in the
  // rest of that payload (votes, cosponsors, etc.) this quick view doesn't
  // show.
  const [aiSummary, setAiSummary] = useState<LoadState<AiSummary | null>>({ status: 'loading' })

  useEffect(() => {
    setAiSummary({ status: 'loading' })
    client
      .getBillDetail(bill.id)
      .then((detail) => setAiSummary({ status: 'ready', data: detail.aiSummary }))
      .catch(() => setAiSummary({ status: 'ready', data: null }))
  }, [bill.id])

  const handleModalTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.propertyName === 'transform' && !visible) onClose()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div
      className={`${styles.overlay} ${visible ? styles.overlayVisible : ''}`}
      onClick={handleClose}
      role="presentation"
    >
      <div
        className={`${styles.modal} ${visible ? styles.modalVisible : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${bill.identifier} details`}
        onClick={(e) => e.stopPropagation()}
        onTransitionEnd={handleModalTransitionEnd}
      >
        <div className={styles.head}>
          <div>
            <div className={styles.identifier}>{bill.identifier}</div>
            {bill.requestNumber && <div className={styles.requestNumber}>{bill.requestNumber}</div>}
          </div>
          <button className={styles.closeButton} onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>

        <h2 className={styles.title}>{bill.title}</h2>

        {aiSummary.status === 'loading' && <div className="skeleton" style={{ height: 90, marginTop: 16 }} />}
        {aiSummary.status === 'ready' && aiSummary.data && (
          <div className={styles.aiSummary}>
            <div className={styles.aiSummaryHead}>
              <span className={styles.aiSummaryEyebrow}>AI-generated summary</span>
              {aiSummary.data.generatedAt && (
                <span className={styles.aiSummaryMeta}>Generated {formatDate(aiSummary.data.generatedAt)}</span>
              )}
            </div>
            <p className={styles.aiSummaryText}>{aiSummary.data.text}</p>
            <p className={styles.aiSummaryDisclaimer}>
              Generated from bill metadata only — not the full bill text. Verify against the official record.
            </p>
          </div>
        )}

        <button className={styles.fullDetailsLink} onClick={onViewFullDetails}>
          View full details — status history, votes, cosponsors →
        </button>

        <div className={styles.section}>
          <div className={styles.sectionEyebrow}>Status</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Current status</span>
            <span className={styles.rowValue}>{bill.status}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Last action</span>
            <span className={styles.rowValue}>
              {bill.lastAction.text} · {formatDate(bill.lastAction.date)}
            </span>
          </div>
          {bill.committee && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Committee</span>
              <span className={styles.rowValue}>{bill.committee}</span>
            </div>
          )}
          <div className={styles.row}>
            <span className={styles.rowLabel}>Position</span>
            <select
              className={styles.editableSelect}
              value={bill.position ?? ''}
              onChange={(e) => onChangePosition((e.target.value || null) as Position)}
            >
              <option value="">No position</option>
              {POSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionEyebrow}>Sponsor</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Name</span>
            <span className={styles.rowValue}>{bill.sponsor.name || 'Not yet assigned'}</span>
          </div>
          {bill.sponsor.district && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>District</span>
              <span className={styles.rowValue}>
                {bill.sponsor.district}
                {bill.sponsor.party ? ` (${bill.sponsor.party})` : ''}
              </span>
            </div>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionEyebrow}>Momentum</div>
          <div className={styles.momentumHead}>
            <span className={styles.momentumScore}>{bill.momentum.score}</span>
            <span
              className={styles.momentumDelta}
              style={{ color: bill.momentum.delta7d >= 0 ? 'var(--teal)' : 'var(--accent, #b9723d)' }}
            >
              {formatSignedDelta(bill.momentum.delta7d)} / 7d
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <Sparkline history={bill.momentum.history} color="var(--low)" />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionEyebrow}>Assignee</div>
          <div className={styles.assignee}>
            <InitialsSquare member={assignee} size={24} />
            <select
              className={styles.editableSelect}
              value={bill.assigneeId ?? ''}
              onChange={(e) => onChangeAssignee(e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {teamMembers.status === 'ready' &&
                teamMembers.data.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
