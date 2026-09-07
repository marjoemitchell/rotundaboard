import styles from './Toast.module.css'

export function Toast({ message }: { message: string }) {
  return (
    <div className={styles.toast} role="status">
      {message}
    </div>
  )
}
