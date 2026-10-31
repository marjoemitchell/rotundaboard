// Subscription plans: what each plan includes, and the checks that enforce
// the limits. This file is the only definition of the plans. The frontend
// gets them from GET /api/plans and GET /api/auth/me.
//
// A limit stops new work only. When a workspace changes to a smaller plan,
// its tracked bills, notes, testimony, and members stay. The workspace
// cannot add more until it is under the limit again.
import { pool } from './db.js'
import { MutationError } from './api/mutations.js'

export const PLAN_KEYS = ['free', 'single_user', 'team', 'organization'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export const FEATURES = ['alerts', 'notes', 'testimony', 'aiSummaries'] as const
export type Feature = (typeof FEATURES)[number]

export interface Plan {
  key: PlanKey
  label: string
  // Prices in whole US dollars. Null when the plan has no price of that kind.
  annualPrice: number | null
  monthlyPrice: number | null
  sessionPassPrice: number | null
  // Null means no limit.
  trackedBillLimit: number | null
  memberLimit: number | null
  features: Record<Feature, boolean>
}

const ALL_FEATURES: Record<Feature, boolean> = { alerts: true, notes: true, testimony: true, aiSummaries: true }

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: 'free',
    label: 'Free',
    annualPrice: 0,
    monthlyPrice: 0,
    sessionPassPrice: null,
    trackedBillLimit: 10,
    memberLimit: 1,
    features: { alerts: false, notes: false, testimony: false, aiSummaries: false },
  },
  single_user: {
    key: 'single_user',
    label: 'Single user',
    annualPrice: 349,
    monthlyPrice: 39,
    sessionPassPrice: 249,
    trackedBillLimit: null,
    memberLimit: 1,
    features: ALL_FEATURES,
  },
  team: {
    key: 'team',
    label: 'Team',
    annualPrice: 1200,
    monthlyPrice: null,
    sessionPassPrice: null,
    trackedBillLimit: null,
    memberLimit: 10,
    features: ALL_FEATURES,
  },
  organization: {
    key: 'organization',
    label: 'Organization',
    annualPrice: 2000,
    monthlyPrice: null,
    sessionPassPrice: null,
    trackedBillLimit: null,
    memberLimit: null,
    features: ALL_FEATURES,
  },
}

// The plans that send email alerts, for the alert queue query (alerts.ts).
export const ALERT_PLAN_KEYS = PLAN_KEYS.filter((k) => PLANS[k].features.alerts)

const FEATURE_NAMES: Record<Feature, string> = {
  alerts: 'email alerts',
  notes: 'notes',
  testimony: 'testimony',
  aiSummaries: 'AI hearing and amendment summaries',
}

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && (PLAN_KEYS as readonly string[]).includes(value)
}

// The plan of a new workspace. The default is the free plan. Set
// NEW_WORKSPACE_PLAN to give new workspaces another plan, for example during
// a beta. The e2e suite sets it to "organization" (playwright.config.ts).
export function newWorkspacePlan(): PlanKey {
  const value = process.env.NEW_WORKSPACE_PLAN
  return isPlanKey(value) ? value : 'free'
}

// A visitor without an account (workspaceId null) gets the free plan.
export async function getWorkspacePlan(workspaceId: number | null): Promise<Plan> {
  if (workspaceId === null) return PLANS.free
  const { rows } = await pool.query<{ plan: string }>('SELECT plan FROM workspaces WHERE id = $1', [workspaceId])
  const key = rows[0]?.plan
  return isPlanKey(key) ? PLANS[key] : PLANS.free
}

export async function hasFeature(workspaceId: number | null, feature: Feature): Promise<boolean> {
  return (await getWorkspacePlan(workspaceId)).features[feature]
}

// 402 Payment Required: the request is correct, but the plan does not allow it.
// The frontend shows a link to the Plans page next to the message.
function planError(message: string): MutationError {
  return new MutationError(402, message)
}

export async function requireFeature(workspaceId: number, feature: Feature): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId)
  if (!plan.features[feature]) {
    throw planError(`The ${plan.label} plan does not include ${FEATURE_NAMES[feature]}.`)
  }
}

export async function requireTrackingRoom(workspaceId: number): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId)
  if (plan.trackedBillLimit == null) return
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM tracked_bills WHERE workspace_id = $1', [
    workspaceId,
  ])
  if (Number(rows[0].n) >= plan.trackedBillLimit) {
    throw planError(`The ${plan.label} plan can track ${plan.trackedBillLimit} bills.`)
  }
}

// An admin sends an invite: an open invite holds a place, so count the open
// invites too. A person accepts an invite: count only the members, and tell
// the person to ask an admin, because the person cannot change the plan.
export async function requireMemberRoom(workspaceId: number, { accepting }: { accepting: boolean }): Promise<void> {
  const plan = await getWorkspacePlan(workspaceId)
  if (plan.memberLimit == null) return
  const { rows } = await pool.query<{ members: string; invites: string }>(
    `SELECT (SELECT count(*) FROM workspace_members WHERE workspace_id = $1) AS members,
            (SELECT count(*) FROM workspace_invites
             WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS invites`,
    [workspaceId],
  )
  const used = Number(rows[0].members) + (accepting ? 0 : Number(rows[0].invites))
  if (used >= plan.memberLimit) {
    if (accepting) {
      throw new MutationError(402, 'This workspace has no place for more members. Ask a workspace admin to change the plan.')
    }
    const people = plan.memberLimit === 1 ? '1 person' : `${plan.memberLimit} people`
    throw planError(`The ${plan.label} plan is for ${people}.`)
  }
}

export async function getPlanUsage(workspaceId: number) {
  const { rows } = await pool.query<{ tracked: string; members: string; invites: string }>(
    `SELECT (SELECT count(*) FROM tracked_bills WHERE workspace_id = $1) AS tracked,
            (SELECT count(*) FROM workspace_members WHERE workspace_id = $1) AS members,
            (SELECT count(*) FROM workspace_invites
             WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS invites`,
    [workspaceId],
  )
  return {
    trackedBills: Number(rows[0].tracked),
    members: Number(rows[0].members),
    pendingInvites: Number(rows[0].invites),
  }
}

export async function setWorkspacePlan(workspaceId: number, plan: string): Promise<Plan> {
  if (!isPlanKey(plan)) throw new MutationError(400, `plan must be one of ${PLAN_KEYS.join(', ')}`)
  const { rowCount } = await pool.query('UPDATE workspaces SET plan = $1, plan_changed_at = now() WHERE id = $2', [
    plan,
    workspaceId,
  ])
  if (!rowCount) throw new MutationError(404, `workspace ${workspaceId} not found`)
  return PLANS[plan]
}
