// Momentum score: a v1 heuristic built only from signals we actually have in
// the scraped data. This is NOT the full 5-factor model from the original
// design spec (sponsor passage rate over prior sessions and committee chair
// disposition aren't computable from a single session's data) — it's a
// simpler 3-factor stand-in until there's enough multi-session history to do
// better:
//
//   60% how far the bill actually got (highest progress-category code
//       reached in its status history, ignoring "Progress Stopped" itself
//       since that's a terminal marker, not a stage — a bill that died on
//       3rd reading should score higher than one that never left drafting)
//   25% recency of its last action (exponential decay, ~180-day half-life)
//   15% legislative activity — floor votes plus committee hearings recorded
//       for the bill, capped at 10
//
// Because the 2025 session ended over a year before this is being computed,
// every bill's recency component will be low and roughly uniform — that's
// an honest reflection of a fully concluded session, not a bug.
//
// History/delta are computed the same way, evaluated as of each cutoff date,
// using only status-history rows that existed by that date. The activity
// component originally used cosponsor count instead, but that count isn't
// timestamped in the source data — every historical point used today's
// current count, which is wrong for a "how much has happened by this date"
// measure. Votes and hearings ARE timestamped, so this both replaces a weak
// signal (a bill can collect cosponsors and then just sit) with a stronger
// one (contested bills draw more hearings and roll-call votes) and fixes a
// real correctness bug in the delta7d/history sparkline along the way.

const MAX_PROGRESS_CODE = 190 // "Became Law"
const PROGRESS_STOPPED_CODE = 5
const FLOOR_STAGE_CODE = 50 // "First Chamber 2nd Reading Process" — reached an actual floor vote
const MAX_ACTIVITY_EVENTS = 10 // p90 of bills with any votes/hearings sit at 9
const RECENCY_HALF_LIFE_DAYS = 180
const HISTORY_WEEKS = 12

export interface StatusPoint {
  occurredAt: Date
  progressCode: number | null
}

export interface MomentumResult {
  score: number
  delta7d: number
  history: number[]
}

function scoreAsOf(statuses: StatusPoint[], activityDates: Date[], cutoff: Date): number {
  const relevant = statuses.filter((s) => s.occurredAt.getTime() <= cutoff.getTime())
  if (relevant.length === 0) return 0

  const progressCodes = relevant
    .map((s) => s.progressCode)
    .filter((c): c is number => c != null && c !== PROGRESS_STOPPED_CODE)
  const maxProgress = progressCodes.length ? Math.max(...progressCodes) : 0
  const progressComponent = Math.min(maxProgress / MAX_PROGRESS_CODE, 1) * 100

  const lastActionAt = relevant.reduce((latest, s) => (s.occurredAt > latest ? s.occurredAt : latest), relevant[0].occurredAt)
  const daysSince = Math.max(0, (cutoff.getTime() - lastActionAt.getTime()) / 86_400_000)
  const recencyComponent = 100 * Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS)

  const activityCount = activityDates.filter((d) => d.getTime() <= cutoff.getTime()).length
  const activityComponent = Math.min(activityCount / MAX_ACTIVITY_EVENTS, 1) * 100

  const raw = 0.6 * progressComponent + 0.25 * recencyComponent + 0.15 * activityComponent
  return Math.round(Math.max(0, Math.min(100, raw)))
}

export type BillOutcome = 'became_law' | 'failed' | 'died'

// A bill's legislative process is over once it's become law, or once its
// session has adjourned (sine die) without that happening — at that point a
// live momentum score/sparkline is misleading (it implies something is still
// moving) rather than informative, so callers should show a static outcome
// instead. Montana's own status codes don't cleanly distinguish "died in
// committee" from "voted down on the floor" (both usually land on the same
// generic "Died in Process" status), so this falls back to the one signal
// that IS reliable: whether the bill ever reached a floor reading. A bill
// that got at least that far and still didn't pass counted as "failed"; one
// that never left committee "died".
export function determineOutcome(statuses: StatusPoint[], sessionEnded: boolean): BillOutcome | null {
  const progressCodes = statuses.map((s) => s.progressCode).filter((c): c is number => c != null && c !== PROGRESS_STOPPED_CODE)
  const maxProgress = progressCodes.length ? Math.max(...progressCodes) : 0
  if (maxProgress >= MAX_PROGRESS_CODE) return 'became_law'
  if (!sessionEnded) return null
  return maxProgress >= FLOOR_STAGE_CODE ? 'failed' : 'died'
}

export function computeMomentum(statuses: StatusPoint[], activityDates: Date[], now: Date = new Date()): MomentumResult {
  const score = scoreAsOf(statuses, activityDates, now)

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const delta7d = score - scoreAsOf(statuses, activityDates, sevenDaysAgo)

  const history: number[] = []
  for (let weeksAgo = HISTORY_WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
    const cutoff = new Date(now.getTime() - weeksAgo * 7 * 86_400_000)
    history.push(scoreAsOf(statuses, activityDates, cutoff))
  }

  return { score, delta7d, history }
}
