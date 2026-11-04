import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../../data/client'
import styles from './AuthPage.module.css'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await client.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      // For example 429: too many requests for this email.
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not send the reset link.')
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
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.subhead}>We'll email you a link to set a new one.</p>

        {sent ? (
          <div className={styles.success} style={{ marginTop: 20 }}>
            If an account exists for that email, a reset link is on its way.
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
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
            <button className={styles.submitButton} type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
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
