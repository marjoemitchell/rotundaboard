import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { AuthenticatedApp } from './AuthenticatedApp'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage'

// Load the public pages only for a visitor without an account. With a static
// import of a new page here, the first e2e tests crashed the browser in about
// half of the runs (the same as with the Plans page). The cause is not known.
const PublicApp = lazy(() => import('./PublicApp').then((m) => ({ default: m.PublicApp })))

// A signed-in person gets the full app. A visitor without an account gets the
// public pages, and the login page for every other path (PublicApp.tsx).
function AppGate() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <AuthenticatedApp />
  return (
    <Suspense fallback={null}>
      <PublicApp />
    </Suspense>
  )
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/*" element={<AppGate />} />
      </Routes>
    </AuthProvider>
  )
}
