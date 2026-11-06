// Finds the Montana House and Senate districts of a street address (issue #69).
//
// The US Census Geocoder finds the address and returns the state legislative
// districts at that point. The service is free and needs no key. See
// https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html.
//
// The address is personal data. This module does not store or log it.
import { USER_AGENT } from './politeFetch.js'

export type DistrictLookup = { matchedAddress: string; house: number; senate: number }

/** The geocoder did not respond, or it sent a response that we cannot read. */
export class AddressLookupUnavailableError extends Error {}

const GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
const TIMEOUT_MS = 8_000
const MONTANA_FIPS = '30'

type CensusGeography = { STATE?: string; BASENAME?: string; NAME?: string }
type CensusMatch = { matchedAddress?: string; geographies?: Record<string, CensusGeography[]> }

// The layer names include the year of the boundaries, for example
// "2026 State Legislative Districts - Lower". Find the layer by the end of the name.
function districtOf(geographies: Record<string, CensusGeography[]>, suffix: string): number | null {
  const key = Object.keys(geographies).find((k) => k.endsWith(suffix))
  const district = key ? geographies[key]?.[0] : undefined
  if (!district || district.STATE !== MONTANA_FIPS) return null
  const n = Number(district.BASENAME)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Reads a Census Geocoder response. Returns null when the response has no Montana match. */
export function parseCensusResponse(body: unknown): DistrictLookup | null {
  const matches = (body as { result?: { addressMatches?: CensusMatch[] } })?.result?.addressMatches
  if (!Array.isArray(matches)) throw new AddressLookupUnavailableError('unexpected geocoder response')
  for (const match of matches) {
    if (!match.geographies) continue
    const house = districtOf(match.geographies, 'State Legislative Districts - Lower')
    const senate = districtOf(match.geographies, 'State Legislative Districts - Upper')
    if (house !== null && senate !== null) return { matchedAddress: match.matchedAddress ?? '', house, senate }
  }
  return null
}

// Results for the e2e suite, by address. The suite must not call the real
// service. The test route in server.ts sets these values. Production ignores them.
type StubResult = DistrictLookup | 'no-match' | 'unavailable'
const stubs = new Map<string, StubResult>()

function stubKey(address: string): string {
  return address.trim().toLowerCase()
}

export function setAddressLookupStub(address: string, result: StubResult) {
  stubs.set(stubKey(address), result)
}

/**
 * Returns the districts of the address, or null when the geocoder finds no
 * Montana address. Throws AddressLookupUnavailableError when the geocoder fails.
 */
export async function lookupDistricts(address: string): Promise<DistrictLookup | null> {
  if (process.env.NODE_ENV !== 'production' && stubs.has(stubKey(address))) {
    const stub = stubs.get(stubKey(address))!
    if (stub === 'unavailable') throw new AddressLookupUnavailableError('stub')
    return stub === 'no-match' ? null : stub
  }

  const url = new URL(GEOCODER_URL)
  url.search = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'all',
    format: 'json',
  }).toString()

  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new AddressLookupUnavailableError('geocoder did not respond')
  }
  if (!res.ok) throw new AddressLookupUnavailableError(`geocoder status ${res.status}`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new AddressLookupUnavailableError('geocoder response is not JSON')
  }
  return parseCensusResponse(body)
}
