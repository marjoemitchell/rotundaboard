import type { LoadState, TeamBoardSummary, TeamMember } from '../../types'
import { formatRelativeTime } from '../../lib/format'
import { InitialsSquare } from '../shared/InitialsSquare'
import { EmptyState } from '../shared/EmptyState'
import styles from './TeamBoard.module.css'

const MAX_ITEMS = 6

export function TeamBoard({
  teamBoard,
  teamMembers,
  onOpen,
  onSelectBill,
}: {
  teamBoard: LoadState<TeamBoardSummary>
  teamMembers: LoadState<TeamMember[]>
  onOpen: () => void
  onSelectBill: (id: string) => void
}) {
  const memberById = new Map<string, TeamMember>(
    teamMembers.status === 'ready' ? teamMembers.data.map((m): [string, TeamMember] => [m.id, m]) : [],
  )

  if (teamBoard.status === 'loading') {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className="eyebrow">Team board</span>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: 32, marginBottom: 10 }} />
        ))}
      </div>
    )
  }

  if (teamBoard.status === 'empty') {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className="eyebrow">Team board</span>
        </div>
        <EmptyState message="No recent activity." />
      </div>
    )
  }

  const data = teamBoard.data
  const items = data.activity.slice(0, MAX_ITEMS)

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className="eyebrow">Team board</span>
        <button className={styles.openLink} onClick={onOpen}>
          Open
        </button>
      </div>

      <div className={styles.list}>
        {items.map((activity) => {
          const actor = memberById.get(activity.actorId) ?? null
          return (
            <button
              key={activity.id}
              className={styles.item}
              onClick={() => activity.billId && onSelectBill(activity.billId)}
              disabled={!activity.billId}
            >
              <InitialsSquare member={actor} size={22} />
              <div className={styles.itemBody}>
                <div className={styles.itemText}>
                  <span className={styles.itemActor}>{actor?.name ?? 'Unknown'}</span> {activity.detail}
                </div>
                <div className={styles.itemTime}>{formatRelativeTime(activity.timestamp)}</div>
              </div>
            </button>
          )
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.stat}>
          <div className={styles.statValue}>{data.toReview}</div>
          <div className={styles.statLabel}>To review</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{data.testimonyDrafts}</div>
          <div className={styles.statLabel}>Testimony drafts</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{data.overdue}</div>
          <div className={styles.statLabel}>Overdue</div>
        </div>
      </div>
    </div>
  )
}
