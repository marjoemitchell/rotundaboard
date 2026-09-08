import styles from './MomentumBar.module.css'

export const MOMENTUM_EXPLANATION =
  'How momentum is scored:\n60% — furthest legislative stage reached\n25% — recency of the last status change\n15% — floor votes + hearings recorded'

function colorFor(score: number): string {
  if (score >= 65) return 'var(--teal)'
  if (score >= 45) return 'var(--mid)'
  return 'var(--low)'
}

export function MomentumBar({ score }: { score: number }) {
  return (
    <div className={styles.wrap} tabIndex={0}>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%`, background: colorFor(score) }}
        />
      </div>
      <span className={styles.score}>{score}</span>
      <span className={styles.bubble} role="tooltip">
        {MOMENTUM_EXPLANATION}
      </span>
    </div>
  )
}
