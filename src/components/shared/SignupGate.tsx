import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import styles from './SignupGate.module.css'

interface SignupGateProps {
  // What the control does, after "Create a free account to". For example: "follow this committee".
  action: string
  // One sentence about what the person gets.
  reason?: string
  // The page that opens after signup or login. The default is the current page.
  returnTo?: string
  // The router state for that page. A page reads it to finish the action (for example useFollowAfterSignup).
  returnState?: Record<string, unknown>
  // The side of the control where the popover aligns.
  align?: 'start' | 'end'
  // Fill the width of the parent, for a control that is a full row of a list.
  block?: boolean
  className?: string
  children: ReactNode
}

// A control that needs an account, for a visitor without an account. The
// control keeps its normal look. A click opens a popover with "Sign up free"
// and "Log in". After signup or login, the person goes to `returnTo`.
export function SignupGate({ action, reason, returnTo, returnState, align = 'end', block = false, className, children }: SignupGateProps) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const signupRef = useRef<HTMLAnchorElement>(null)
  const popoverId = useId()

  const from = returnTo
    ? { pathname: returnTo, search: '', state: returnState ?? null }
    : { ...location, state: returnState ?? null }

  useEffect(() => {
    if (!open) return
    signupRef.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span ref={wrapRef} className={`${styles.wrap} ${block ? styles.block : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${className ?? ''}`}
        title={`Sign up to ${action}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <span
          id={popoverId}
          role="dialog"
          aria-label="Create an account"
          className={`${styles.popover} ${align === 'start' ? styles.alignStart : styles.alignEnd}`}
        >
          <span className={styles.text}>
            Create a free account to {action}.{reason ? ` ${reason}` : ''}
          </span>
          <span className={styles.actions}>
            <Link ref={signupRef} to="/signup" state={{ from }} className={styles.signup}>
              Sign up free
            </Link>
            <Link to="/login" state={{ from }} className={styles.login}>
              Log in
            </Link>
          </span>
        </span>
      )}
    </span>
  )
}
