import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import * as client from '../../data/client'
import { useAuth } from '../../auth/AuthContext'
import styles from './AuthPage.module.css'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await client.resetPassword(token, password)
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not reset your password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <img src="/logo-mark.svg" alt="" width={44} height={44} />
          <span className={styles.wordmark}>
            Rotunda <span className={styles.wordmarkLight}>Board</span>
          </span>
        </div>
        <h1 className={styles.title}>Set a new password</h1>
        <p className={styles.subhead}>This also signs you out everywhere else, for safety.</p>

        {!token ? (
          <div className={styles.error} style={{ marginTop: 20 }}>
            This link is missing its reset token — use the link from your email.
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.formRow}>
              <label className={styles.formLabel} htmlFor="password">
                New password
              </label>
              <input
                id="password"
                className={styles.formInput}
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className={styles.submitButton} type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}

        <div className={styles.footer}>
          <Link to="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}
