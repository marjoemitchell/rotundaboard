// Request limits for each client and for each email address.
//
// The counts are in memory. This is correct while the API runs as one Railway
// instance. If the API runs as more than one instance, move the counts to
// Postgres or to a shared store.
import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

// In production, the browser sends API requests to the web service, and the
// web service proxy sends them to the API (vite.config.ts). The proxy adds
// these two headers. The API trusts the client address only when the secret
// is correct. A client can send these headers too, but it does not know the
// secret.
export const PROXY_SECRET_HEADER = 'x-rotunda-proxy-secret'
export const PROXY_CLIENT_IP_HEADER = 'x-rotunda-client-ip'

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function fromTrustedProxy(req: Request): boolean {
  const secret = process.env.API_PROXY_SECRET
  const sent = headerValue(req, PROXY_SECRET_HEADER)
  if (!secret || !sent) return false
  return timingSafeEqual(sha256(secret), sha256(sent))
}

/**
 * The key of the client for the limits. The key does not use X-Forwarded-For,
 * because the client can set that header.
 *
 * - A request from the web service proxy uses the address that the proxy sends.
 * - Other requests use X-Real-IP, then the socket address. The Railway edge
 *   sets X-Real-IP on requests to a public domain.
 *
 * The two kinds of keys have different prefixes. Thus a request that goes
 * directly to the API cannot use up the limit of a client of the web service.
 */
export function clientKey(req: Request): string {
  if (fromTrustedProxy(req)) {
    const address = headerValue(req, PROXY_CLIENT_IP_HEADER)
    if (address) return `proxy:${address}`
  }
  return `direct:${headerValue(req, 'x-real-ip') ?? req.socket.remoteAddress ?? 'unknown'}`
}

// Direct addresses that have no client limits. The e2e suite sets this value
// for the loopback addresses (playwright.config.ts), because all the tests
// come from one address. Production ignores this value.
function exemptAddresses(): Set<string> {
  if (process.env.NODE_ENV === 'production') return new Set()
  return new Set(
    (process.env.RATE_LIMIT_EXEMPT_ADDRESSES ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => `direct:${a}`),
  )
}

const allLimiters: RateLimiter[] = []

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>()

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {
    allLimiters.push(this)
  }

  private entry(key: string, now: number) {
    const entry = this.hits.get(key)
    if (entry && now - entry.windowStart < this.windowMs) return entry
    return undefined
  }

  private secondsLeft(windowStart: number, now: number): number {
    return Math.max(1, Math.ceil((windowStart + this.windowMs - now) / 1000))
  }

  /** Returns the seconds until the key can try again, or 0 if the key is not at the limit. */
  check(key: string, now = Date.now()): number {
    const entry = this.entry(key, now)
    return entry && entry.count >= this.max ? this.secondsLeft(entry.windowStart, now) : 0
  }

  /** Counts one request. Returns the seconds until the key can try again, or 0 if the request is in the limit. */
  hit(key: string, now = Date.now()): number {
    const entry = this.entry(key, now)
    if (!entry) {
      this.hits.set(key, { count: 1, windowStart: now })
      return 0
    }
    entry.count++
    return entry.count > this.max ? this.secondsLeft(entry.windowStart, now) : 0
  }

  removeOld(now: number) {
    for (const [key, entry] of this.hits) if (now - entry.windowStart >= this.windowMs) this.hits.delete(key)
  }
}

// Remove the old entries, so that the maps do not grow without a limit.
setInterval(() => {
  const now = Date.now()
  for (const limiter of allLimiters) limiter.removeOld(now)
}, 60_000).unref()

/** Sends 429 with a Retry-After header and a message that the user can read. */
export function sendTooManyRequests(res: Response, retryAfterSeconds: number) {
  const minutes = Math.ceil(retryAfterSeconds / 60)
  res.setHeader('Retry-After', String(retryAfterSeconds))
  res.status(429).json({
    error: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
  })
}

/**
 * Counts one request for the client. Returns false and sends 429 if the
 * client is over the limit.
 */
export function hitClientLimit(limiter: RateLimiter, req: Request, res: Response): boolean {
  const key = clientKey(req)
  if (exemptAddresses().has(key)) return true
  const wait = limiter.hit(key)
  if (wait > 0) {
    sendTooManyRequests(res, wait)
    return false
  }
  return true
}

/** Middleware that applies a client limit to each request. */
export function limitEachClient(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hitClientLimit(limiter, req, res)) next()
  }
}

/** The key of an email address for the limits. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase()
}

/** Writes a warning at startup when production has no proxy secret. */
export function warnIfNoProxySecret() {
  if (process.env.NODE_ENV === 'production' && !process.env.API_PROXY_SECRET) {
    console.warn(
      '[rate-limit] API_PROXY_SECRET is not set. Requests from the web service proxy can share one client limit.',
    )
  }
}
