import { Link, useLocation } from 'react-router-dom'
import { usePublicView } from '../../lib/publicView'
import styles from './UpgradeNotice.module.css'

// Shows in place of a feature that the plan of the workspace does not include.
// A visitor without an account gets a link to sign up instead of the plans.
export function UpgradeNotice({ message }: { message: string }) {
  const isPublic = usePublicView()
  const location = useLocation()
  return (
    <div className={styles.notice} role="note" aria-label="Upgrade">
      <span>{message}</span>
      {isPublic ? (
        <Link className={styles.link} to="/signup" state={{ from: location }}>
          Sign up
        </Link>
      ) : (
        <Link className={styles.link} to="/plans">
          See the plans
        </Link>
      )}
    </div>
  )
}
