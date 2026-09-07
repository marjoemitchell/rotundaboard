import { useState } from 'react'
import type { LoadState, TeamMember } from '../types'
import { InitialsSquare, OverflowSquare } from './shared/InitialsSquare'
import styles from './TopBar.module.css'

const VISIBLE_AVATARS = 4

export function TopBar({
  teamMembers,
  onOpenPalette,
  onFilterByAssignee,
}: {
  teamMembers: LoadState<TeamMember[]>
  onOpenPalette: () => void
  onFilterByAssignee: (memberId: string) => void
}) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const members = teamMembers.status === 'ready' ? teamMembers.data : []
  const visible = members.slice(0, VISIBLE_AVATARS)
  const hidden = members.slice(VISIBLE_AVATARS)

  const handlePick = (memberId: string) => {
    setOverflowOpen(false)
    onFilterByAssignee(memberId)
  }

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <img className={styles.logo} src="/logo-mark-dark.svg" alt="" width={26} height={26} />
        <span className={styles.wordmark}>
          Rotunda <span className={styles.wordmarkLight}>Board</span>
        </span>
      </div>
      <div className={styles.spacer} />
      <button className={styles.palette} onClick={onOpenPalette} aria-haspopup="dialog">
        <span className={styles.paletteText}>Jump to a bill, hearing, or legislator…</span>
        <span className={styles.paletteHint}>⌘K</span>
      </button>
      <div className={styles.avatars}>
        {visible.map((member) => (
          <button
            key={member.id}
            className={styles.avatarButton}
            onClick={() => handlePick(member.id)}
            aria-label={`Filter bills assigned to ${member.name}`}
          >
            <InitialsSquare member={member} size={24} />
          </button>
        ))}
        {hidden.length > 0 && (
          <div className={styles.overflowWrap}>
            <button
              className={styles.avatarButton}
              onClick={() => setOverflowOpen((o) => !o)}
              aria-label={`${hidden.length} more team members`}
              aria-expanded={overflowOpen}
            >
              <OverflowSquare count={hidden.length} size={24} />
            </button>
            {overflowOpen && (
              <>
                <div className={styles.overflowScrim} onClick={() => setOverflowOpen(false)} />
                <div className={styles.overflowMenu}>
                  {hidden.map((member) => (
                    <button key={member.id} className={styles.overflowItem} onClick={() => handlePick(member.id)}>
                      <InitialsSquare member={member} size={20} />
                      {member.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
