import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import * as client from '../../data/client'
import { useAuth } from '../../auth/AuthContext'
import styles from './AuthPage.module.css'

export function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await client.login(email.trim(), password)
      await refresh()
      const from = (location.state as { from?: Location } | null)?.from
      navigate(from ? `${from.pathname}${from.search}` : '/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not sign in.')
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
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subhead}>Track legislation with your coalition.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={styles.formInput}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className={styles.formInput}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className={styles.submitButton} type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className={styles.footer}>
          <Link to="/forgot-password">Forgot password?</Link>
          <div style={{ marginTop: 8 }}>
            New coalition? <Link to="/signup">Create a workspace</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
