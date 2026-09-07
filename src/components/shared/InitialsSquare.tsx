import type { TeamMember } from '../../types'
import styles from './InitialsSquare.module.css'

export function InitialsSquare({
  member,
  size = 24,
  title,
}: {
  member: TeamMember | null
  size?: number
  title?: string
}) {
  if (!member) {
    return (
      <span
        className={styles.square}
        style={{ width: size, height: size, background: 'var(--soft)', color: 'var(--faint)' }}
        title={title ?? 'Unassigned'}
      >
        —
      </span>
    )
  }
  return (
    <span
      className={styles.square}
      style={{ width: size, height: size, background: member.color }}
      title={title ?? member.name}
    >
      {member.initials}
    </span>
  )
}

export function OverflowSquare({ count, size = 24 }: { count: number; size?: number }) {
  return (
    <span
      className={styles.square}
      style={{ width: size, height: size, background: 'var(--ink-2)' }}
      title={`${count} more`}
    >
      +{count}
    </span>
  )
}
