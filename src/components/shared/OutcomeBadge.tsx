import type { BillOutcome } from '../../types'
import styles from './OutcomeBadge.module.css'

const LABELS: Record<NonNullable<BillOutcome>, string> = {
  became_law: 'Became law',
  failed: 'Failed',
  died: 'Died',
}

export function OutcomeBadge({ outcome }: { outcome: BillOutcome }) {
  if (!outcome) return null
  return <span className={`${styles.badge} ${styles[outcome]}`}>{LABELS[outcome]}</span>
}
