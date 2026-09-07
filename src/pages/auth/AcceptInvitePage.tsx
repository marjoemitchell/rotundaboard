import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import * as client from '../../data/client'
import { useAuth } from '../../auth/AuthContext'
import type { InviteLookup } from '../../types'
import styles from './AuthPage.module.css'

type LoadState = { status: 'loading' } | { status: 'invalid' } | { status: 'ready'; data: InviteLookup }

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const { session, refresh } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setState({ status: 'invalid' })
      return
    }
    client
      .getInvite(token)
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'invalid' }))
  }, [token])

  const handleAcceptAsCurrentUser = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await client.acceptInvite(token)
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not accept this invite.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLoginAndAccept = async (e: FormEvent) => {
    e.preventDefault()
    if (state.status !== 'ready') return
    setError(null)
    setSubmitting(true)
    try {
      await client.login(state.data.email, password)
      await client.acceptInvite(token)
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not accept this invite.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignupAndAccept = async (e: FormEvent) => {
    e.preventDefault()
    if (state.status !== 'ready') return
    setError(null)
    setSubmitting(true)
    try {
      await client.signup({ email: state.data.email, password, name: name.trim(), inviteToken: token })
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*: /, '') : 'Could not create your account.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state.status === 'loading') {
    return (
      <div className={styles.page}>
        <div className={styles.card} />
      </div>
    )
  }

  if (state.status === 'invalid') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <img src="/logo-mark.svg" alt="" width={44} height={44} />
            <span className={styles.wordmark}>
              Rotunda <span className={styles.wordmarkLight}>Board</span>
            </span>
          </div>
          <h1 className={styles.title}>Invite not found</h1>
          <p className={styles.subhead}>This invite link is invalid, expired, or has already been used.</p>
          <div className={styles.footer}>
            <Link to="/login">Back to sign in</Link>
          </div>
        </div>
      </div>
    )
  }

  const invite = state.data

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <img src="/logo-mark.svg" alt="" width={44} height={44} />
          <span className={styles.wordmark}>
            Rotunda <span className={styles.wordmarkLight}>Board</span>
          </span>
        </div>
        <h1 className={styles.title}>Join {invite.workspaceName}</h1>
        <p className={styles.subhead}>
          You've been invited as {invite.role === 'admin' ? 'an admin' : 'a member'} — {invite.email}.
        </p>

        {error && <div className={styles.error} style={{ marginTop: 16 }}>{error}</div>}

        {session && session.user.email === invite.email ? (
          <div className={styles.form}>
            <button className={styles.submitButton} onClick={handleAcceptAsCurrentUser} disabled={submitting}>
              {submitting ? 'Joining…' : `Accept and join ${invite.workspaceName}`}
            </button>
          </div>
        ) : session ? (
          <div className={styles.form}>
            <div className={styles.error}>
              You're signed in as {session.user.email}, but this invite is for {invite.email}. Log out and sign back
              in as {invite.email} to accept it.
            </div>
          </div>
        ) : invite.accountExists ? (
          <form className={styles.form} onSubmit={handleLoginAndAccept}>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Email</label>
              <input className={styles.formInput} value={invite.email} disabled />
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
              {submitting ? 'Joining…' : 'Sign in and accept'}
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={handleSignupAndAccept}>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Email</label>
              <input className={styles.formInput} value={invite.email} disabled />
            </div>
            <div className={styles.formRow}>
              <label className={styles.formLabel} htmlFor="name">
                Your name
              </label>
              <input id="name" className={styles.formInput} value={name} onChange={(e) => setName(e.target.value)} required />
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
              {submitting ? 'Creating…' : `Create account and join`}
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
