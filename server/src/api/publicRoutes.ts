// Routes for visitors without an account. They show the public data of the
// Legislature: what a free workspace sees, without workspace data. The
// server mounts this router before the session check (server.ts).
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import * as queries from './queries.js'
import * as billTexts from './billTexts.js'
import { hasFeature } from '../plans.js'

export const publicRouter = Router()

// A limit on the requests of each client, against scrapers.
const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 120
const hits = new Map<string, { count: number; windowStart: number }>()

// In production the request comes through the Railway edge and the web
// service proxy, so req.ip is a proxy address. Use the first address in
// X-Forwarded-For. A client can set that header, so a client can avoid the
// limit, but a client cannot use up the limit of another person.
function clientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first || req.socket.remoteAddress || 'unknown'
}

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now()
  const key = clientKey(req)
  const entry = hits.get(key)
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now })
  } else if (++entry.count > MAX_REQUESTS_PER_WINDOW) {
    res.setHeader('Retry-After', String(Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000)))
    res.status(429).json({ error: 'too many requests' })
    return
  }
  next()
}

// Remove the old entries, so that the map does not grow without a limit.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of hits) if (now - entry.windowStart >= WINDOW_MS) hits.delete(key)
}, WINDOW_MS).unref()

publicRouter.use(rateLimit)

function parseId(value: string, res: Response, what: string): number | null {
  const id = Number(value)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: `invalid ${what} id` })
    return null
  }
  return id
}

publicRouter.get('/bills/:id', async (req, res) => {
  const billId = parseId(req.params.id, res, 'bill')
  if (billId === null) return
  try {
    const detail = await queries.getBillDetail(billId, null)
    if (!detail) {
      res.status(404).json({ error: `bill ${billId} not found` })
      return
    }
    res.json(detail)
  } catch (err) {
    console.error(`GET /api/public/bills/${req.params.id} failed:`, err)
    res.status(500).json({ error: 'internal error' })
  }
})

// Legislators: the same data as for a workspace. The map has no tracked
// counts, because a visitor tracks no bills.
async function sendJson(res: Response, path: string, load: () => Promise<unknown>) {
  try {
    const data = await load()
    if (data === null) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.json(data)
  } catch (err) {
    console.error(`GET /api/public${path} failed:`, err)
    res.status(500).json({ error: 'internal error' })
  }
}

publicRouter.get('/legislators', (_req, res) => sendJson(res, '/legislators', () => queries.getLegislators()))

// Before /legislators/:id, so that "map" is not taken as an id.
publicRouter.get('/legislators/map', (_req, res) => sendJson(res, '/legislators/map', () => queries.getLegislatorMap(null)))

publicRouter.get('/legislators/:id', (req, res) => {
  const id = parseId(req.params.id, res, 'legislator')
  if (id === null) return
  return sendJson(res, `/legislators/${id}`, () => queries.getLegislatorDetail(id))
})

// Interim committees and hearings: the same data as for a workspace, with
// no followed committees.
publicRouter.get('/committees', (_req, res) => sendJson(res, '/committees', () => queries.getNonStandingCommittees(null)))

publicRouter.get('/committees/:id', (req, res) => {
  const id = parseId(req.params.id, res, 'committee')
  if (id === null) return
  return sendJson(res, `/committees/${id}`, () => queries.getNonStandingCommitteeDetail(id, null))
})

publicRouter.get('/hearings/schedule', (_req, res) => sendJson(res, '/hearings/schedule', () => queries.getUpcomingHearings(null)))

// The list of recent recordings. The audio and the transcript need an account.
publicRouter.get('/hearings', (_req, res) => sendJson(res, '/hearings', () => queries.getRecordedHearings(null)))

// The changes that one amendment makes to the bill text. A visitor gets no
// AI summary of the amendment, the same as the free plan.
publicRouter.get('/bills/:id/amendment-documents/:documentId', async (req, res) => {
  const billId = parseId(req.params.id, res, 'bill')
  if (billId === null) return
  const documentId = parseId(req.params.documentId, res, 'document')
  if (documentId === null) return
  try {
    const result = await billTexts.getAmendmentChanges(billId, documentId)
    if (!result) {
      res.status(404).json({ error: 'amendment text not found' })
      return
    }
    const showSummary = await hasFeature(null, 'aiSummaries')
    res.json(showSummary ? result : { ...result, summary: null })
  } catch (err) {
    console.error(`GET /api/public/bills/${req.params.id}/amendment-documents failed:`, err)
    res.status(500).json({ error: 'internal error' })
  }
})
