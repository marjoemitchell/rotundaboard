import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={styles.wrap} tabIndex={0}>
      {children}
      <span className={styles.bubble} role="tooltip">
        {label}
      </span>
    </span>
  )
}
