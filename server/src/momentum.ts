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
//   15% cosponsor count, capped at 20
//
// Because the 2025 session ended over a year before this is being computed,
// every bill's recency component will be low and roughly uniform — that's
// an honest reflection of a fully concluded session, not a bug.
//
// History/delta are computed the same way, evaluated as of each cutoff date,
// using only status-history rows that existed by that date. Cosponsor count
// is not timestamped in the source data, so the same current count is used
// for every historical point — a known simplification.

const MAX_PROGRESS_CODE = 190 // "Became Law"
const PROGRESS_STOPPED_CODE = 5
const MAX_COSPONSORS = 20
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

function scoreAsOf(statuses: StatusPoint[], cosponsorCount: number, cutoff: Date): number {
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

  const cosponsorComponent = Math.min(cosponsorCount / MAX_COSPONSORS, 1) * 100

  const raw = 0.6 * progressComponent + 0.25 * recencyComponent + 0.15 * cosponsorComponent
  return Math.round(Math.max(0, Math.min(100, raw)))
}

export function computeMomentum(statuses: StatusPoint[], cosponsorCount: number, now: Date = new Date()): MomentumResult {
  const score = scoreAsOf(statuses, cosponsorCount, now)

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const delta7d = score - scoreAsOf(statuses, cosponsorCount, sevenDaysAgo)

  const history: number[] = []
  for (let weeksAgo = HISTORY_WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
    const cutoff = new Date(now.getTime() - weeksAgo * 7 * 86_400_000)
    history.push(scoreAsOf(statuses, cosponsorCount, cutoff))
  }

  return { score, delta7d, history }
}
