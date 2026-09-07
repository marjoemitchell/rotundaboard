import { Link } from 'react-router-dom'
import type { LoadState, NavCounts, SavedView } from '../types'
import { useAuth } from '../auth/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import { InitialsSquare } from './shared/InitialsSquare'
import styles from './LeftNav.module.css'

export type NavId =
  | 'all-bills'
  | 'lc-drafts'
  | 'introduced'
  | 'hearings'
  | 'legislators'
  | 'sessions'
  | 'tracking-board'
  | 'notes'
  | 'watches'
  | 'committees'
  | 'testimony'
  | 'digests'
  | `view:${string}`

// Nav badges mean two different things and were previously styled the
// same, which reads as "there's only 1 tracked bill" when the real count
// (all tracked bills) is much higher: personal counts are workspace data
// you might act on (a total, or a to-review queue); reference counts are
// just the size of a global lookup table (every legislator we have, every
// hearing on record) — not something to work through, so the destination
// page's own header is the right place for that number, not a nav badge.
function NavItem({
  id,
  label,
  count,
  loading,
  activeId,
  onNavigate,
  hideCount,
  emphasize,
  indent,
}: {
  id: NavId
  label: string
  count?: number
  loading: boolean
  activeId: NavId
  onNavigate: (id: NavId) => void
  hideCount?: boolean
  emphasize?: boolean
  indent?: boolean
}) {
  const display = loading ? '···' : count ? String(count) : ''
  return (
    <button
      className={`${styles.item} ${activeId === id ? styles.itemActive : ''} ${indent ? styles.itemIndent : ''}`}
      onClick={() => onNavigate(id)}
      aria-current={activeId === id ? 'page' : undefined}
    >
      <span className={styles.label}>{label}</span>
      {!hideCount && (
        <span className={`${styles.count} ${emphasize && count ? styles.countEmphasis : ''}`}>{display}</span>
      )}
    </button>
  )
}

export function LeftNav({
  activeId,
  navCounts,
  savedViews,
  isOpen,
  onNavigate,
  onDeleteView,
}: {
  activeId: NavId
  navCounts: LoadState<NavCounts>
  savedViews: LoadState<SavedView[]>
  isOpen: boolean
  onNavigate: (id: NavId) => void
  onDeleteView: (viewId: string) => void
}) {
  const { session, logout, switchWorkspace } = useAuth()
  const counts = navCounts.status === 'ready' ? navCounts.data : null
  const countsLoading = navCounts.status === 'loading'
  const views = savedViews.status === 'ready' ? savedViews.data : []
  const { confirm, confirmDialog } = useConfirm()

  return (
    <nav className={`${styles.nav} ${isOpen ? styles.navOpen : ''}`} aria-label="Primary">
      {confirmDialog}
      <button className={styles.sessionSelector} onClick={() => onNavigate('sessions')}>
        Browse sessions
      </button>

      <div className={styles.navScroll}>
        <div className={styles.group}>
          <div className={`${styles.groupLabel} eyebrow`}>Tracking</div>
          <NavItem id="all-bills" label="All bills" count={counts?.allBills} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} />
          <NavItem id="lc-drafts" label="LC drafts" count={counts?.lcDrafts} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} indent />
          <NavItem id="introduced" label="Introduced (HB / SB)" count={counts?.introduced} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} indent />
          <NavItem id="hearings" label="Hearings" loading={countsLoading} activeId={activeId} onNavigate={onNavigate} hideCount />
          <NavItem id="legislators" label="Legislators" loading={countsLoading} activeId={activeId} onNavigate={onNavigate} hideCount />
          <NavItem id="watches" label="Subject watches" count={counts?.subjectWatches} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} />
          <NavItem id="committees" label="Interim committees" loading={countsLoading} activeId={activeId} onNavigate={onNavigate} hideCount />
        </div>
        <div className={styles.group}>
          <div className={`${styles.groupLabel} eyebrow`}>Workspace</div>
          <NavItem id="tracking-board" label="Tracking board" count={counts?.trackingBoard} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} emphasize />
          <NavItem id="notes" label="Notes" count={counts?.notes} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} />
          <NavItem id="testimony" label="Testimony" count={counts?.testimony} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} emphasize />
          <NavItem id="digests" label="Digests" count={counts?.digests} loading={countsLoading} activeId={activeId} onNavigate={onNavigate} />
        </div>
        <div className={styles.group}>
          <div className={`${styles.groupLabel} eyebrow`}>Saved filters</div>
          {views.map((view) => (
            <div key={view.id} className={styles.savedViewRow}>
              <button
                className={`${styles.item} ${styles.itemWithSwatch} ${activeId === `view:${view.id}` ? styles.itemActive : ''}`}
                onClick={() => onNavigate(`view:${view.id}`)}
              >
                <span className={styles.swatch} style={{ background: view.color }} aria-hidden />
                <span className={styles.label}>{view.name}</span>
              </button>
              <button
                className={styles.deleteViewButton}
                onClick={async (e) => {
                  e.stopPropagation()
                  if (await confirm(`Remove saved view "${view.name}"?`, { confirmLabel: 'Remove' })) onDeleteView(view.id)
                }}
                aria-label={`Delete saved view ${view.name}`}
              >
                ×
              </button>
            </div>
          ))}
          {savedViews.status === 'ready' && views.length === 0 && (
            <div className={styles.groupLabel} style={{ color: 'var(--faint)', fontSize: 16 }}>
              No saved views yet
            </div>
          )}
        </div>
      </div>

      {session && (
        <div className={styles.account}>
          {session.workspaces.length > 1 ? (
            <select
              className={styles.workspaceSelect}
              value={session.currentWorkspace?.id ?? ''}
              onChange={(e) => switchWorkspace(Number(e.target.value))}
              aria-label="Switch workspace"
            >
              {session.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <div className={styles.workspaceName}>{session.currentWorkspace?.name ?? ''}</div>
          )}
          <div className={styles.accountRow}>
            <InitialsSquare
              member={{ id: String(session.user.id), name: session.user.name, initials: session.user.initials, color: session.user.color }}
              size={22}
            />
            <span className={styles.accountName}>{session.user.name}</span>
          </div>
          <div className={styles.accountActions}>
            <Link className={styles.accountAction} to="/settings">
              Settings
            </Link>
            <button className={styles.accountAction} onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
