import styles from './Sparkline.module.css'

export function Sparkline({ history, color = '#a9bacd' }: { history: number[]; color?: string }) {
  const max = Math.max(...history, 1)
  return (
    <div className={styles.sparkline} role="img" aria-label={`Momentum history: ${history.join(', ')}`}>
      {history.map((value, i) => (
        <span
          key={i}
          className={styles.bar}
          style={{ height: `${Math.max((value / max) * 100, 6)}%`, background: color }}
        />
      ))}
    </div>
  )
}
