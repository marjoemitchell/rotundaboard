import 'dotenv/config'
import { recordFetchError, recordResponse } from './scrapeHealth.js'
import type {
  RawAmendment,
  RawBillCosponsor,
  RawBillFilterPage,
  RawBillVote,
  RawBillHearingSearchPage,
  RawCommitteeMeetingBillHearing,
  RawCommitteeTabsResponse,
  RawDocument,
  RawExecutiveAction,
  RawLegislator,
  RawNonStandingCommittee,
  RawNonStandingCommitteeMeetingPage,
  RawSession,
  RawStandingCommittee,
} from './legmtTypes.js'

const BASE = process.env.LEGMT_API_BASE ?? 'https://bearbeta.legmt.gov'
// The committee "tabs" content (Meeting Materials, Studies/Topics, etc.) is
// served by legmt.gov's public WordPress site, not the bearbeta API — a
// completely separate host and system.
const WP_BASE = process.env.LEGMT_WP_BASE ?? 'https://www.legmt.gov'
const USER_AGENT = 'RotundaBoard/0.1 (bill-tracking research tool; contact: rotundaboard project)'

// Each request names its endpoint for the scrape health checks
// (scrapeHealth.ts). They count the items, check the shape of each item,
// and count the failed requests. Outside a monitored scrape run, the
// reports do nothing.
async function monitored<T>(endpoint: string, request: () => Promise<T>, items: (data: T) => unknown[]): Promise<T> {
  let data: T
  try {
    data = await request()
  } catch (err) {
    recordFetchError(endpoint, err)
    throw err
  }
  recordResponse(endpoint, items(data))
  return data
}

const asList = <T>(data: T) => (Array.isArray(data) ? data : [data])

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GET ${url} -> ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

function getList<T>(endpoint: string, url: string): Promise<T> {
  return monitored(endpoint, () => getJson<T>(url), asList)
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST ${url} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export function getSessions(): Promise<RawSession[]> {
  return getList('sessions', `${BASE}/legislators/v1/sessions`)
}

export function getLegislators(): Promise<RawLegislator[]> {
  return getList('legislators', `${BASE}/legislators/v1/legislators`)
}

export function getStandingCommittees(): Promise<RawStandingCommittee[]> {
  return getList('standingCommittees', `${BASE}/committees/v1/standingCommittees`)
}

export function getNonStandingCommittees(legislatureId: number): Promise<RawNonStandingCommittee[]> {
  return getList('nonStandingCommittees', `${BASE}/committees/v1/nonStandingCommittees/findByLegislatureId?legislatureId=${legislatureId}`)
}

const PAGE_SIZE = 500

export function getVotesForBill(billId: number): Promise<RawBillVote[]> {
  return getList('billVotes', `${BASE}/bills/v1/votes/findByBillId?billId=${billId}`)
}

export function getAmendmentsForBill(billId: number): Promise<RawAmendment[]> {
  return getList('amendments', `${BASE}/bills/v1/amendments/findByBillId?billId=${billId}`)
}

export function getCosponsorsForBill(billId: number): Promise<RawBillCosponsor[]> {
  return getList('cosponsors', `${BASE}/bills/v1/billCosponsors/findByBillId?billId=${billId}`)
}

export function getHearingsForBill(billId: number): Promise<RawCommitteeMeetingBillHearing[]> {
  return getList('billHearings', `${BASE}/committees/v1/standingCommitteeMeetingBillHearings/findByBillId?billId=${billId}`)
}

export function getExecutiveActionsForBill(billId: number): Promise<RawExecutiveAction[]> {
  return getList('executiveActions', `${BASE}/committees/v1/executiveActions/findByBillId?billId=${billId}`)
}

// Despite the name, the API's `offset` query param is a page NUMBER (Spring
// Data Pageable), not a row offset — confirmed by probing: offset=1&limit=500
// returns rows 501-1000, and offset=500&limit=500 (i.e. "page 500") returns
// nothing despite thousands of matching rows. Page through by page count,
// not by accumulated row count.
export async function* iterateBillsForSession(sessionId: number) {
  let page = 0
  while (true) {
    const url = `${BASE}/bills/v1/bills/filter?limit=${PAGE_SIZE}&offset=${page}&sort=id,asc`
    const result = await monitored(
      'bills',
      () => postJson<RawBillFilterPage>(url, [{ sessionIds: [sessionId] }]),
      (page) => page.content,
    )
    for (const bill of result.content) yield bill
    if (result.content.length < PAGE_SIZE) break
    page += 1
  }
}

export function getCommitteeTabs(lawsId: number): Promise<RawCommitteeTabsResponse> {
  return getList(
    'committeeTabs',
    `${WP_BASE}/wp-json/legmt/v1/committees/search?committeesEntity=NonStandingCommittee&lawsId=${lawsId}`,
  )
}

export async function* iterateNonStandingCommitteeMeetings(committeeIds: number[]) {
  if (committeeIds.length === 0) return
  let page = 0
  while (true) {
    const url = `${BASE}/committees/v1/nonStandingCommitteeMeetings/search?limit=${PAGE_SIZE}&offset=${page}&sort=id,asc`
    const result = await monitored(
      'nonStandingCommitteeMeetings',
      () => postJson<RawNonStandingCommitteeMeetingPage>(url, { nonStandingCommitteeIds: committeeIds }),
      (page) => page.content,
    )
    for (const meeting of result.content) yield meeting
    if (result.content.length < PAGE_SIZE) break
    page += 1
  }
}

// Every bill hearing for the given standing committees, in one paged search.
// The per-bill endpoint (getHearingsForBill) needs one request for each bill.
// This one needs about 8 requests for a full session, so refreshHearings.ts
// can run each hour. Found in committees.legmt.gov's own bundle.
export async function* iterateBillHearings(standingCommitteeIds: number[]) {
  if (standingCommitteeIds.length === 0) return
  for (let page = 0; ; page += 1) {
    const url = `${BASE}/committees/v1/standingCommitteeMeetingBillHearings/search?limit=${PAGE_SIZE}&offset=${page}`
    const result = await monitored(
      'billHearingSearch',
      () => postJson<RawBillHearingSearchPage>(url, { standingCommitteeIds }),
      (p) => p.content,
    )
    for (const hearing of result.content) yield hearing
    if (result.content.length < PAGE_SIZE || page + 1 >= result.totalPages) break
  }
}

// Bill text documents (versions and amendments) from the document store.
// The store finds the files by a folder path: legislature ordinal (69),
// session ordinals (20251), and the bill type and number. A bill that has no
// documents yet gives a 404 "No Folder found" error. That is not a failure,
// so these functions return an empty list for it.
export interface BillDocumentRef {
  legislatureOrdinal: number
  sessionOrdinals: string
  billType: string
  billNumber: number
}

async function getDocumentList(endpoint: string, path: string, ref: BillDocumentRef): Promise<RawDocument[]> {
  const params = new URLSearchParams({
    legislatureOrdinal: String(ref.legislatureOrdinal),
    sessionOrdinal: ref.sessionOrdinals,
    billType: ref.billType,
    billNumber: String(ref.billNumber),
  })
  const url = `${BASE}/docs/v1/documents/${path}?${params}`
  return monitored(
    endpoint,
    async () => {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (res.status === 404) return []
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`GET ${url} -> ${res.status}: ${body.slice(0, 300)}`)
      }
      return (await res.json()) as RawDocument[]
    },
    asList,
  )
}

export function getBillVersionDocuments(ref: BillDocumentRef): Promise<RawDocument[]> {
  return getDocumentList('billVersionDocuments', 'getBillVersions', ref)
}

export function getBillAmendmentDocuments(ref: BillDocumentRef): Promise<RawDocument[]> {
  return getDocumentList('billAmendmentDocuments', 'getBillAmendments', ref)
}

/** The bytes of a document (a PDF for bill versions and amendments). */
export async function getDocumentContent(documentId: number): Promise<Uint8Array> {
  const url = `${BASE}/docs/v1/documents/getContent?documentId=${documentId}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
