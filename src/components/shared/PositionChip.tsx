import type { Position } from '../../types'
import styles from './PositionChip.module.css'

const LABELS: Record<NonNullable<Position>, string> = {
  support: 'Support',
  oppose: 'Oppose',
  watch: 'Watch',
  neutral: 'Neutral',
}

export function PositionChip({ position }: { position: Position }) {
  if (!position) return <span className={styles.empty}>—</span>
  return <span className={`${styles.chip} ${styles[position]}`}>{LABELS[position]}</span>
}
