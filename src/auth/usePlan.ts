import { useAuth } from './AuthContext'
import type { Plan, PlanFeature } from '../types'

// The plan of the current workspace. The server enforces every limit. The
// frontend uses the plan only to show an upgrade notice instead of a control
// that the server refuses.
export function usePlan(): { plan: Plan | null; has: (feature: PlanFeature) => boolean } {
  const { session } = useAuth()
  const plan = session?.currentWorkspace?.plan ?? null
  // Before the session loads, show the controls. The server still checks.
  return { plan, has: (feature) => plan?.features[feature] ?? true }
}
