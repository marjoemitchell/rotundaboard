import type { LoadState, MomentumFactor } from '../../types'
import styles from './MomentumModel.module.css'

export function MomentumModel({
  factors,
  onHide,
}: {
  factors: LoadState<MomentumFactor[]>
  onHide: () => void
}) {
  if (factors.status === 'loading') {
    return (
      <div className={styles.card}>
        <div className="skeleton" style={{ height: 14, width: '50%', marginBottom: 12 }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 16, marginBottom: 8 }} />
        ))}
      </div>
    )
  }

  if (factors.status === 'empty') return null

  const maxWeight = Math.max(...factors.data.map((f) => f.weight))

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className="eyebrow">Momentum model</span>
        <button className={styles.hideLink} onClick={onHide}>
          Hide
        </button>
      </div>

      {factors.data.map((factor) => (
        <div className={styles.row} key={factor.label}>
          <span className={styles.weight}>{factor.weight}%</span>
          <span className={styles.barTrack}>
            <span className={styles.barFill} style={{ width: `${(factor.weight / maxWeight) * 100}%` }} />
          </span>
          <span className={styles.label}>{factor.label}</span>
        </div>
      ))}

      <div className={styles.footer}>
        Score is 0–100. Each tracked bill shows its trailing 12-week history as a sparkline so the
        7-day delta is independently verifiable.
      </div>
    </div>
  )
}

export function MomentumModelToggle({ onShow }: { onShow: () => void }) {
  return (
    <button className={styles.showToggle} onClick={onShow}>
      + Show momentum model
    </button>
  )
}
