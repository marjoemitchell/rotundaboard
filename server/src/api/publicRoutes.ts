// Routes for visitors without an account. They show the public data of the
// Legislature: what a free workspace sees, without workspace data. The
// server mounts this router before the session check (server.ts).
import { Router } from 'express'
import type { Response } from 'express'
import * as queries from './queries.js'
import * as billTexts from './billTexts.js'
import { hasFeature, PLAN_KEYS, PLANS } from '../plans.js'
import { hitClientLimit, limitEachClient, RateLimiter } from './rateLimit.js'
import { AddressLookupUnavailableError, lookupDistricts } from '../addressLookup.js'
import { suggestAddresses } from '../addressSuggest.js'

export const publicRouter = Router()

// A limit on the requests of each client, against scrapers. See rateLimit.ts
// for how the API finds the client.
publicRouter.use(limitEachClient(new RateLimiter(120, 60_000)))

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

// The House and Senate districts of a street address (issue #69). Each
// request calls an outside service, so this route has a lower client limit.
// Do not log the address: it is personal data.
const addressLookupLimiter = new RateLimiter(10, 60_000)

publicRouter.get('/legislators/lookup', async (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : ''
  if (address.length < 5 || address.length > 200) {
    res.status(400).json({ error: 'Type a street address, for example "1301 E 6th Ave, Helena, MT".' })
    return
  }
  if (!hitClientLimit(addressLookupLimiter, req, res)) return
  try {
    const result = await lookupDistricts(address)
    if (!result) {
      res.status(404).json({ error: 'No Montana address matches.' })
      return
    }
    res.json(result)
  } catch (err) {
    if (err instanceof AddressLookupUnavailableError) {
      console.error(`GET /api/public/legislators/lookup: the geocoder failed (${err.message})`)
      res.status(503).json({ error: 'The address search is not available now.' })
      return
    }
    console.error('GET /api/public/legislators/lookup failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// Address suggestions while a person types in the address search
// (addressSuggest.ts). The page waits for a pause in typing before each
// request, but one address still makes some requests, so the limit is higher.
// This route must come before /legislators/:id. Do not log the text.
const addressSuggestLimiter = new RateLimiter(60, 60_000)

publicRouter.get('/legislators/address-suggestions', async (req, res) => {
  const text = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (text.length < 3 || text.length > 200) {
    res.json({ suggestions: [] })
    return
  }
  if (!hitClientLimit(addressSuggestLimiter, req, res)) return
  res.json({ suggestions: await suggestAddresses(text) })
})

publicRouter.get('/legislators/:id', (req, res) => {
  const id = parseId(req.params.id, res, 'legislator')
  if (id === null) return
  return sendJson(res, `/legislators/${id}`, () => queries.getLegislatorDetail(id))
})

// The plans and their prices and limits, for the Plans page. A visitor has
// no workspace, so the response has no current plan and no usage.
publicRouter.get('/plans', (_req, res) => sendJson(res, '/plans', async () => ({ plans: PLAN_KEYS.map((key) => PLANS[key]) })))

// Sessions and the bills of a session: the same data as for a workspace. A
// visitor tracks no bills, so the tracked counts are 0.
publicRouter.get('/sessions', (_req, res) => sendJson(res, '/sessions', () => queries.getSessions(null)))

publicRouter.get('/sessions/:id/bills', (req, res) => {
  const id = parseId(req.params.id, res, 'session')
  if (id === null) return
  return sendJson(res, `/sessions/${id}/bills`, () => queries.getSessionBills(id, null))
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
