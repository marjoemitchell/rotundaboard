import type { Bill, Brief, LoadState } from '../../types'
import { formatTime, formatDate } from '../../lib/format'
import styles from './AIBrief.module.css'

function renderSummary(summary: string) {
  const parts = summary.split(/\*\*(.*?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>,
  )
}

export function AIBrief({
  brief,
  bills,
  onSelectBill,
  onSendBrief,
  sending,
}: {
  brief: LoadState<Brief>
  bills: LoadState<Bill[]>
  onSelectBill: (id: string) => void
  onSendBrief: () => void
  sending: boolean
}) {
  const billById = new Map<string, Bill>(
    bills.status === 'ready' ? bills.data.map((b): [string, Bill] => [b.id, b]) : [],
  )

  if (brief.status === 'loading') {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.eyebrow}>Morning brief</span>
        </div>
        <div className="skeleton" style={{ height: 12, marginBottom: 8, background: 'var(--ink-hairline)' }} />
        <div className="skeleton" style={{ height: 12, width: '90%', background: 'var(--ink-hairline)' }} />
      </div>
    )
  }

  if (brief.status === 'empty') {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.eyebrow}>Morning brief</span>
        </div>
        <p className={styles.summary} style={{ color: 'var(--ink-faint)' }}>
          No brief has been generated yet.
        </p>
      </div>
    )
  }

  const b = brief.data

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Morning brief</span>
        <span className={styles.timestamp}>
          Generated {formatDate(b.generatedAt)}, {formatTime(b.generatedAt)}
        </span>
      </div>

      <p className={styles.summary}>{renderSummary(b.summary)}</p>

      <div className={styles.hairline} />

      <div className={styles.taggedList}>
        {b.taggedItems.map((item, i) => (
          <div className={styles.taggedItem} key={i}>
            <span className={styles.tag}>{item.tag}</span>
            <span className={styles.taggedText}>
              {item.text}{' '}
              {item.sourceIds.map((sourceId, j) => {
                const bill = billById.get(sourceId)
                if (!bill) return null
                return (
                  <span key={sourceId}>
                    {j > 0 && ', '}
                    <button className={styles.sourceLink} onClick={() => onSelectBill(sourceId)}>
                      {bill.identifier}
                    </button>
                  </span>
                )
              })}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        Sourced from {b.sourceCounts.actions} actions, {b.sourceCounts.hearings} hearings, and{' '}
        {b.sourceCounts.fiscalNotes} fiscal notes. Every claim above links to its source record.
      </div>

      <button className={styles.sendButton} onClick={onSendBrief} disabled={sending}>
        {sending ? 'Sending…' : 'Send this brief →'}
      </button>
    </div>
  )
}
