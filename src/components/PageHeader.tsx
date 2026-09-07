import styles from './PageHeader.module.css'

export function PageHeader({
  title,
  subhead,
  onSecondaryAction,
  secondaryLabel,
  onPrimaryAction,
  primaryLabel,
}: {
  title: string
  subhead: string
  onSecondaryAction: () => void
  secondaryLabel: string
  onPrimaryAction?: () => void
  primaryLabel?: string
}) {
  return (
    <div className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subhead}>{subhead}</p>
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
