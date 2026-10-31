import { Link } from 'react-router-dom'
import styles from './UpgradeNotice.module.css'

// Shows in place of a feature that the plan of the workspace does not include.
// The link opens the Plans page. A visitor without an account can open it too.
export function UpgradeNotice({ message }: { message: string }) {
  return (
    <div className={styles.notice} role="note" aria-label="Upgrade">
      <span>{message}</span>
      <Link className={styles.link} to="/plans">
        See the plans
      </Link>
    </div>
  )
}
