import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

// A link to the signup page for a visitor without an account. After signup,
// the person comes back to this page.
export function SignupLink({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  const location = useLocation()
  return (
    <Link to="/signup" state={{ from: location }} className={className} title={title}>
      {children}
    </Link>
  )
}
