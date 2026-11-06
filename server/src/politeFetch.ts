// Every scraper request to a Legislature host goes through politeFetch. It
// obeys the robots.txt file of the host (RFC 9309):
//  - It does not request a path that robots.txt disallows for us.
//  - It keeps the gap between requests that the Crawl-delay line asks for.
// The gap applies to all scraper processes together. The cron jobs share one
// row for each host in the crawl_slots table, so two jobs that run at the same
// time do not double the request rate.
import { pool } from './db.js'

/** Our product token in robots.txt groups. */
export const ROBOT_NAME = 'RotundaBoard'
export const USER_AGENT = `${ROBOT_NAME}/0.1 (+https://rotundaboard.com; support@rotundaboard.com)`

// RFC 9309 lets a crawler keep a robots.txt file for a maximum of 24 hours.
const ROBOTS_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Rule {
  allow: boolean
  pattern: string
}

export interface RobotsPolicy {
  rules: Rule[]
  /** Seconds between two requests. 0 when robots.txt asks for no gap. */
  crawlDelay: number
}

const ALLOW_ALL: RobotsPolicy = { rules: [], crawlDelay: 0 }

export class RobotsDisallowedError extends Error {
  constructor(url: string, reason: string) {
    super(`robots.txt does not let ${ROBOT_NAME} request ${url}: ${reason}`)
    this.name = 'RobotsDisallowedError'
  }
}

/**
 * Reads a robots.txt file and returns the policy for our product token. The
 * group that names our token applies. If no group names it, the "*" group
 * applies. If the file has neither, we have no limits.
 */
export function parseRobots(text: string, robotName = ROBOT_NAME): RobotsPolicy {
  interface Group {
    agents: string[]
    rules: Rule[]
    crawlDelay: number | null
  }
  const groups: Group[] = []
  let current: Group | null = null
  // A group starts with one or more user-agent lines. A rule line after them
  // closes the list of agents.
  let collectingAgents = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (key === 'user-agent') {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [], crawlDelay: null }
        groups.push(current)
        collectingAgents = true
      }
      current.agents.push(value.toLowerCase())
      continue
    }
    if (!current) continue
    collectingAgents = false
    if (key === 'allow' || key === 'disallow') {
      // An empty "Disallow:" line disallows nothing.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value })
    } else if (key === 'crawl-delay') {
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds
    }
  }

  const token = robotName.toLowerCase()
  let matched = groups.filter((g) => g.agents.includes(token))
  if (matched.length === 0) matched = groups.filter((g) => g.agents.includes('*'))
  if (matched.length === 0) return ALLOW_ALL

  // RFC 9309: combine all groups that name the same agent.
  const delays = matched.map((g) => g.crawlDelay).filter((d): d is number => d !== null)
  return {
    rules: matched.flatMap((g) => g.rules),
    crawlDelay: delays.length ? Math.max(...delays) : 0,
  }
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path)
}

/**
 * Tells if the policy lets us request the path (with its query string). The
 * longest matching rule applies. If an allow rule and a disallow rule have the
 * same length, the allow rule applies (RFC 9309).
 */
export function isAllowed(policy: RobotsPolicy, pathAndQuery: string): boolean {
  let best: Rule | null = null
  for (const rule of policy.rules) {
    if (!patternMatches(rule.pattern, pathAndQuery)) continue
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule
    }
  }
  return best ? best.allow : true
}

const policies = new Map<string, { fetchedAt: number; policy: Promise<RobotsPolicy> }>()

async function loadPolicy(origin: string): Promise<RobotsPolicy> {
  let res: Response
  try {
    res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    // RFC 9309: if the host cannot be reached, the crawler must assume that
    // everything is disallowed.
    throw new RobotsDisallowedError(origin, `cannot read robots.txt (${err instanceof Error ? err.message : err})`)
  }
  // RFC 9309: a 4xx status means "no robots.txt", so there are no limits. A
  // 5xx status means "unreachable", so everything is disallowed.
  if (res.status >= 400 && res.status < 500) return ALLOW_ALL
  if (!res.ok) throw new RobotsDisallowedError(origin, `robots.txt returned ${res.status}`)
  return parseRobots(await res.text())
}

function policyFor(origin: string): Promise<RobotsPolicy> {
  const cached = policies.get(origin)
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_MAX_AGE_MS) return cached.policy
  const policy = loadPolicy(origin)
  policies.set(origin, { fetchedAt: Date.now(), policy })
  // Do not keep a failure. The next request tries robots.txt again.
  policy.catch(() => policies.delete(origin))
  return policy
}

// The local fallback for crawl_slots: the next free time of each host in this
// process only. It applies when the table does not exist yet (a cron job that
// starts before the API deploy applies the migration).
const localNextAt = new Map<string, number>()

function reserveLocalSlot(host: string, delayMs: number): number {
  const now = Date.now()
  const slot = Math.max(now, localNextAt.get(host) ?? 0)
  localNextAt.set(host, slot + delayMs)
  return slot - now
}

/** Takes the next free request time for the host and returns the wait in ms. */
async function reserveSlot(host: string, delaySeconds: number): Promise<number> {
  try {
    const { rows } = await pool.query<{ wait_ms: number }>(
      `INSERT INTO crawl_slots (host, next_at) VALUES ($1, clock_timestamp() + make_interval(secs => $2))
       ON CONFLICT (host) DO UPDATE
         SET next_at = greatest(crawl_slots.next_at, clock_timestamp()) + make_interval(secs => $2)
       RETURNING greatest(0, extract(epoch FROM next_at - make_interval(secs => $2) - clock_timestamp()) * 1000)::float8 AS wait_ms`,
      [host, delaySeconds],
    )
    return rows[0].wait_ms
  } catch (err) {
    if ((err as { code?: string }).code !== '42P01') throw err // 42P01: the table does not exist.
    return reserveLocalSlot(host, delaySeconds * 1000)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sends a request in the same way as fetch, after the robots.txt checks. It
 * adds our User-Agent header. It throws RobotsDisallowedError if robots.txt
 * disallows the URL.
 */
export async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url)
  const policy = await policyFor(target.origin)
  if (!isAllowed(policy, target.pathname + target.search)) {
    throw new RobotsDisallowedError(url, 'the path is disallowed')
  }
  if (policy.crawlDelay > 0) {
    const waitMs = await reserveSlot(target.host, policy.crawlDelay)
    if (waitMs > 0) await sleep(waitMs)
  }
  const headers = new Headers(init.headers)
  headers.set('User-Agent', USER_AGENT)
  return fetch(url, { ...init, headers })
}
