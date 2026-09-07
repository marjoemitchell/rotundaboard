import type { ReactNode } from 'react'
import type { Bill, LoadState } from '../types'
import { formatSignedDelta } from '../lib/format'
import { Sparkline } from './shared/Sparkline'
import { EmptyState } from './shared/EmptyState'
import styles from './MovingNow.module.css'

const MOMENTUM_THRESHOLD = 60

function MoverCard({ bill, onSelectBill }: { bill: Bill; onSelectBill: (id: string) => void }) {
  return (
    <button className={styles.card} onClick={() => onSelectBill(bill.id)}>
      <div className={styles.cardTop}>
        <span className={styles.identifier}>{bill.identifier}</span>
        <span className={`${styles.delta} ${bill.momentum.delta7d >= 0 ? styles.deltaUp : styles.deltaDown}`}>
          {formatSignedDelta(bill.momentum.delta7d)}
        </span>
      </div>
      <div className={styles.cardTitle}>{bill.title}</div>
      <div className={styles.sparklineWrap}>
        <Sparkline history={bill.momentum.history} />
      </div>
      <div className={styles.footer}>
        <span className={styles.stage}>{bill.status}</span>
        <span className={styles.score}>{bill.momentum.score}</span>
      </div>
    </button>
  )
}

export function MovingNow({
  bills,
  onSelectBill,
}: {
  bills: LoadState<Bill[]>
  onSelectBill: (id: string) => void
}) {
  let body: ReactNode

  if (bills.status === 'loading') {
    body = (
      <div className={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.card}>
            <div className="skeleton" style={{ height: 16, width: '50%' }} />
            <div className="skeleton" style={{ height: 34, marginTop: 8 }} />
            <div className="skeleton" style={{ height: 28, marginTop: 12 }} />
          </div>
        ))}
      </div>
    )
  } else if (bills.status === 'empty') {
    body = <EmptyState message="No tracked bills yet." />
  } else {
    const moving = bills.data
      .filter((b) => b.momentum.score >= MOMENTUM_THRESHOLD)
      .sort((a, b) => b.momentum.delta7d - a.momentum.delta7d)

    body =
      moving.length === 0 ? (
        <EmptyState message={`No bills currently above momentum ${MOMENTUM_THRESHOLD}.`} />
      ) : (
        <div className={styles.grid}>
          {moving.map((bill) => (
            <MoverCard key={bill.id} bill={bill} onSelectBill={onSelectBill} />
          ))}
        </div>
      )
  }

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Moving now</h2>
        <span className={styles.subhead}>Momentum ≥ {MOMENTUM_THRESHOLD}, sorted by 7-day delta</span>
      </div>
      {body}
    </section>
  )
}
