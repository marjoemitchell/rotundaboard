import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BillDetailPage } from './pages/BillDetailPage'
import { PublicViewContext } from './lib/publicView'
import styles from './PublicApp.module.css'

// The paths that a visitor without an account can open.
const PUBLIC_BILL_PATH = /^\/bills\/\d+\/?$/

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_BILL_PATH.test(pathname)
}

const NO_MEMBERS = { status: 'empty' } as const
const noop = () => {}

// The app for a visitor without an account: a header with "Log in" and
// "Sign up", and the read-only page. Other paths go to the login page.
export function PublicApp() {
  const location = useLocation()
  if (!isPublicPath(location.pathname)) return <Navigate to="/login" state={{ from: location }} replace />

  return (
    <PublicViewContext.Provider value={true}>
      <header className={styles.bar}>
        <div className={styles.brand}>
          <img src="/logo-mark-dark.svg" alt="" width={26} height={26} />
          <span className={styles.wordmark}>
            Rotunda <span className={styles.wordmarkLight}>Board</span>
          </span>
        </div>
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
        </Routes>
      </main>
    </PublicViewContext.Provider>
  )
}
