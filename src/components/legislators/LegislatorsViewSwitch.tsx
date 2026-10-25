import { Link } from 'react-router-dom'
import styles from './LegislatorsViewSwitch.module.css'

// The two views of the legislators: the county map (/legislators) and the
// list with search (/legislators/list).
export function LegislatorsViewSwitch({ current }: { current: 'map' | 'list' }) {
  return (
    <nav className={styles.switch} aria-label="Legislators view">
      <Link to="/legislators" className={current === 'map' ? styles.on : undefined} aria-current={current === 'map' ? 'page' : undefined}>
        Map
      </Link>
      <Link
        to="/legislators/list"
        className={current === 'list' ? styles.on : undefined}
        aria-current={current === 'list' ? 'page' : undefined}
      >
        List
      </Link>
    </nav>
  )
}
