// Protection against cross-site request forgery (CSRF).
//
// In production the session cookie has SameSite=None (authMiddleware.ts). The
// browser sends it with requests from all sites. CORS stops another site from
// reading a response, but the API still does the request. A plain HTML form
// on another site can send a POST with no CORS check.
//
// This middleware refuses a request that changes data when the request comes
// from a page on another origin. Browsers send the Origin header on all
// cross-origin POST, PUT, PATCH, and DELETE requests, and a page cannot change
// that header.
import type { NextFunction, Request, Response } from 'express'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The origin of the web app. All requests that change data come from pages on this origin. */
export function appOrigin(): string {
  return new URL(process.env.APP_BASE_URL ?? 'http://localhost:5173').origin
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// The origin of the Referer URL, or "invalid" if the URL is not correct.
function refererOrigin(referer: string): string {
  try {
    return new URL(referer).origin
  } catch {
    return 'invalid'
  }
}

/**
 * Refuses a POST, PUT, PATCH, or DELETE request with 403 when its Origin is
 * not the web app. Without Origin, the check uses the origin of Referer.
 * A request with neither header did not come from a page in a browser
 * (for example curl or the e2e request client), so the check accepts it.
 */
export function rejectCrossSiteRequests(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }
  const origin = headerValue(req.headers.origin)
  const referer = headerValue(req.headers.referer)
  const source = origin ?? (referer ? refererOrigin(referer) : undefined)
  if (source === undefined || source === appOrigin()) {
    next()
    return
  }
  res.status(403).json({ error: 'This request came from another site. The server refused it.' })
}
