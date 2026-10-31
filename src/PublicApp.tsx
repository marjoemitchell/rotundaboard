import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AllBillsPage } from './pages/AllBillsPage'
import { BillDetailPage } from './pages/BillDetailPage'
import { CommitteeDetailPage } from './pages/CommitteeDetailPage'
import { CommitteesPage } from './pages/CommitteesPage'
import { HearingsPage } from './pages/HearingsPage'
import { LegislatorDetailPage } from './pages/LegislatorDetailPage'
import { LegislatorsMapPage } from './pages/LegislatorsMapPage'
import { LegislatorsPage } from './pages/LegislatorsPage'
import { PublicHomePage } from './pages/PublicHomePage'
import { PublicViewContext } from './lib/publicView'
import styles from './PublicApp.module.css'

// The paths that a visitor without an account can open.
const PUBLIC_PATHS = [
  /^\/$/,
  /^\/bills(\/\d+)?\/?$/,
  /^\/legislators(\/list|\/\d+)?\/?$/,
  /^\/committees(\/\d+)?\/?$/,
  /^\/hearings\/?$/,
]

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => p.test(pathname))
}

const NO_MEMBERS = { status: 'empty' } as const
const noop = () => {}
// A visitor cannot track a bill. The Track button opens a signup popover (SignupGate), so this function does not run.
const rejectTrack = () => Promise.reject(new Error('An account is necessary to track a bill.'))

// The app for a visitor without an account: a header with "Log in" and
// "Sign up", and the read-only page. Other paths go to the login page.
export function PublicApp() {
  const location = useLocation()
  if (!isPublicPath(location.pathname)) return <Navigate to="/login" state={{ from: location }} replace />

  return (
    <PublicViewContext.Provider value={true}>
      <header className={styles.bar}>
        <Link to="/" className={styles.brand} aria-label="Rotunda Board home">
          <img src="/logo-mark-dark.svg" alt="" width={26} height={26} />
          <span className={styles.wordmark}>
            Rotunda <span className={styles.wordmarkLight}>Board</span>
          </span>
        </Link>
        <nav className={styles.nav} aria-label="Public pages">
          <Link to="/bills" className={styles.navLink}>
            Bills
          </Link>
          <Link to="/legislators" className={styles.navLink}>
            Legislators
          </Link>
          <Link to="/committees" className={styles.navLink}>
            Committees
          </Link>
          <Link to="/hearings" className={styles.navLink}>
            Hearings
          </Link>
        </nav>
        <div className={styles.actions}>
          <Link to="/login" state={{ from: location }} className={styles.login}>
            Log in
          </Link>
          <Link to="/signup" state={{ from: location }} className={styles.signup}>
            Sign up free
          </Link>
        </div>
      </header>
      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<PublicHomePage />} />
          <Route path="/bills" element={<AllBillsPage onTrackBill={rejectTrack} onUntrackBill={rejectTrack} />} />
          <Route
            path="/bills/:id"
            element={
              <BillDetailPage
                teamMembers={NO_MEMBERS}
                onChangePosition={noop}
                onChangeAssignee={noop}
                onTrackBill={noop}
                onUntrackBill={noop}
              />
            }
          />
          <Route path="/legislators" element={<LegislatorsMapPage />} />
          <Route path="/legislators/list" element={<LegislatorsPage />} />
          <Route path="/legislators/:id" element={<LegislatorDetailPage />} />
          <Route path="/committees" element={<CommitteesPage />} />
          <Route path="/committees/:id" element={<CommitteeDetailPage />} />
          <Route path="/hearings" element={<HearingsPage />} />
        </Routes>
      </main>
    </PublicViewContext.Provider>
  )
}
