import { Link } from 'react-router-dom'
import { plural } from '../../lib/format'
import styles from './DashboardCards.module.css'

export const SETUP_TRACK_TARGET = 5
const DISMISSED_KEY = 'rb.setupDismissed'

export function readSetupDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function storeSetupDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, 'true')
  } catch {
    // Storage is not available (private window). The card shows again next time.
  }
}

interface Item {
  label: string
  hint: string
  done: boolean
  action: { label: string; to?: string; onClick?: () => void }
}

// Four steps that make the dashboard useful. A done step stays in the list,
// struck through. When all steps are done, the dashboard hides the card for good.
export function SetupChecklist({
  activeCount,
  watchCount,
  missingPositions,
  memberCount,
  onFindBills,
  onShowMissingPositions,
}: {
  activeCount: number
  watchCount: number
  /** Active tracked bills with no position. */
  missingPositions: number
  memberCount: number
  onFindBills: () => void
  onShowMissingPositions: () => void
}) {
  const items: Item[] = [
    {
      label: `Track ${SETUP_TRACK_TARGET} bills or LC drafts`,
      hint:
        activeCount >= SETUP_TRACK_TARGET
          ? `${plural(activeCount, 'active bill')} tracked.`
          : `${activeCount} of ${SETUP_TRACK_TARGET} active bills tracked. The dashboard follows the bills that you track.`,
      done: activeCount >= SETUP_TRACK_TARGET,
      action: { label: 'Find bills', onClick: onFindBills },
    },
    {
      label: 'Pick subject watches',
      hint: watchCount > 0 ? `${plural(watchCount, 'watch', 'watches')} set up.` : 'Get new LC drafts on the subjects that you follow.',
      done: watchCount > 0,
      action: { label: 'Add a watch', to: '/watches' },
    },
    {
      label: 'Set a position on every tracked bill',
      hint:
        missingPositions > 0
          ? `${plural(missingPositions, 'tracked bill')} ${missingPositions === 1 ? 'has' : 'have'} no position.`
          : activeCount > 0
            ? 'Every active tracked bill has a position.'
            : 'Track a bill first.',
      done: activeCount > 0 && missingPositions === 0,
      action: { label: 'Show them', onClick: onShowMissingPositions },
    },
    {
      label: 'Invite a teammate',
      hint: memberCount >= 2 ? `${plural(memberCount, 'member')} in this workspace.` : 'Share tracking, positions, and testimony with your team.',
      done: memberCount >= 2,
      action: { label: 'Invite', to: '/settings' },
    },
  ]
  const doneCount = items.filter((i) => i.done).length

  return (
    <section className={styles.card} aria-label="Get set up">
      <div className={styles.head}>
        <span className="eyebrow">Get set up</span>
        <span className={styles.headRight}>
          {doneCount} of {items.length}
        </span>
      </div>
      {items.map((item) => (
        <div key={item.label} className={styles.row} data-done={item.done || undefined}>
          <span className={`${styles.check} ${item.done ? styles.checkDone : ''}`} aria-hidden="true">
            {item.done ? '✓' : ''}
          </span>
          <div className={styles.rowMain}>
            <div className={`${styles.label} ${item.done ? styles.labelDone : ''}`}>
              {item.label}
              {item.done && <span className="visually-hidden"> (done)</span>}
            </div>
            <div className={styles.hint}>{item.hint}</div>
          </div>
          {!item.done &&
            (item.action.to ? (
              <Link className={styles.action} to={item.action.to}>
                {item.action.label}
              </Link>
            ) : (
              <button className={styles.action} onClick={item.action.onClick}>
                {item.action.label}
              </button>
            ))}
        </div>
      ))}
    </section>
  )
}
