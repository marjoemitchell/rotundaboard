import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

export function PageHeader({
  title,
  subhead,
  onSecondaryAction,
  secondaryLabel,
  onPrimaryAction,
  primaryLabel,
  meta,
}: {
  title: string
  subhead: string
  onSecondaryAction: () => void
  secondaryLabel: string
  onPrimaryAction?: () => void
  primaryLabel?: string
  /** A short line below the subhead, for example the data freshness. */
  meta?: ReactNode
}) {
  return (
    <div className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subhead}>{subhead}</p>
        {meta}
      </div>
      <div className={styles.actions}>
        <button className={styles.btnSecondary} onClick={onSecondaryAction}>
          {secondaryLabel}
        </button>
        {onPrimaryAction && (
          <button className={styles.btnPrimary} onClick={onPrimaryAction}>
            {primaryLabel}
          </button>
        )}
      </div>
    </div>
  )
}
