import 'dotenv/config'
import type {
  RawAmendment,
  RawBillCosponsor,
  RawBillFilterPage,
  RawBillVote,
  RawCommitteeMeetingBillHearing,
  RawExecutiveAction,
  RawLegislator,
  RawNonStandingCommittee,
  RawNonStandingCommitteeMeetingPage,
  RawSession,
  RawStandingCommittee,
} from './legmtTypes.js'

const BASE = process.env.LEGMT_API_BASE ?? 'https://bearbeta.legmt.gov'
const USER_AGENT = 'RotundaBoard/0.1 (bill-tracking research tool; contact: rotundaboard project)'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GET ${url} -> ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
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
  return getJson(`${BASE}/legislators/v1/sessions`)
}

export function getLegislators(): Promise<RawLegislator[]> {
  return getJson(`${BASE}/legislators/v1/legislators`)
}

export function getStandingCommittees(): Promise<RawStandingCommittee[]> {
  return getJson(`${BASE}/committees/v1/standingCommittees`)
}

export function getNonStandingCommittees(legislatureId: number): Promise<RawNonStandingCommittee[]> {
  return getJson(`${BASE}/committees/v1/nonStandingCommittees/findByLegislatureId?legislatureId=${legislatureId}`)
}

const PAGE_SIZE = 500

export function getVotesForBill(billId: number): Promise<RawBillVote[]> {
  return getJson(`${BASE}/bills/v1/votes/findByBillId?billId=${billId}`)
}

export function getAmendmentsForBill(billId: number): Promise<RawAmendment[]> {
  return getJson(`${BASE}/bills/v1/amendments/findByBillId?billId=${billId}`)
}

export function getCosponsorsForBill(billId: number): Promise<RawBillCosponsor[]> {
  return getJson(`${BASE}/bills/v1/billCosponsors/findByBillId?billId=${billId}`)
}

export function getHearingsForBill(billId: number): Promise<RawCommitteeMeetingBillHearing[]> {
  return getJson(`${BASE}/committees/v1/standingCommitteeMeetingBillHearings/findByBillId?billId=${billId}`)
}

export function getExecutiveActionsForBill(billId: number): Promise<RawExecutiveAction[]> {
  return getJson(`${BASE}/committees/v1/executiveActions/findByBillId?billId=${billId}`)
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
    const result = await postJson<RawBillFilterPage>(url, [{ sessionIds: [sessionId] }])
    for (const bill of result.content) yield bill
    if (result.content.length < PAGE_SIZE) break
    page += 1
  }
}

export async function* iterateNonStandingCommitteeMeetings(committeeIds: number[]) {
  if (committeeIds.length === 0) return
  let page = 0
  while (true) {
    const url = `${BASE}/committees/v1/nonStandingCommitteeMeetings/search?limit=${PAGE_SIZE}&offset=${page}&sort=id,asc`
    const result = await postJson<RawNonStandingCommitteeMeetingPage>(url, { nonStandingCommitteeIds: committeeIds })
    for (const meeting of result.content) yield meeting
    if (result.content.length < PAGE_SIZE) break
    page += 1
  }
}
