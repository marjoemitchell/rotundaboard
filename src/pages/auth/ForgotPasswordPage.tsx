import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../../data/client'
import styles from './AuthPage.module.css'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await client.forgotPassword(email.trim())
      setSent(true)
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
