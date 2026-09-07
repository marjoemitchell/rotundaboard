import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as client from '../../data/client'
import { useAuth } from '../../auth/AuthContext'
import styles from './AuthPage.module.css'

export function SignupPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await client.signup({ email: email.trim(), password, name: name.trim(), workspaceName: workspaceName.trim() })
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not create your account.')
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
        <h1 className={styles.title}>Create a workspace</h1>
        <p className={styles.subhead}>Set up a new coalition workspace — you'll be its first admin.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor="workspaceName">
              Coalition name
            </label>
            <input
              id="workspaceName"
              className={styles.formInput}
              placeholder="Montana Conservation Coalition"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              required
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel} htmlFor="name">
              Your name
            </label>
            <input id="name" className={styles.formInput} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
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
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className={styles.submitButton} type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create workspace'}
          </button>
        </form>

        <div className={styles.footer}>
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
