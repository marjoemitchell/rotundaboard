import { Link } from 'react-router-dom'
import styles from './Toast.module.css'

// A short message at the bottom of the page. With `plansLink`, the message is
// a plan limit, and the toast has a link to the Plans page.
export function Toast({ message, plansLink = false }: { message: string; plansLink?: boolean }) {
  return (
    <div className={styles.toast} role="status">
      {message}
      {plansLink && (
        <>
          {' '}
          <Link to="/plans" className={styles.link}>
            See the plans
          </Link>
        </>
      )}
    </div>
  )
}
