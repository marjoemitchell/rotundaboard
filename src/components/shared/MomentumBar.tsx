import styles from './MomentumBar.module.css'

function colorFor(score: number): string {
  if (score >= 65) return 'var(--teal)'
  if (score >= 45) return 'var(--mid)'
  return 'var(--low)'
}

export function MomentumBar({ score }: { score: number }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%`, background: colorFor(score) }}
        />
      </div>
      <span className={styles.score}>{score}</span>
    </div>
  )
}
