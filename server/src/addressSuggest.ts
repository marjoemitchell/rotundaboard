// Address suggestions for the address search on the Legislators page.
//
// Photon (https://photon.komoot.io) finds OpenStreetMap addresses that start
// with the typed text. The service is free and needs no key. The suggestions
// only complete the text. The Census Geocoder (addressLookup.ts) still finds
// the districts.
//
// The address is personal data. This module does not store or log it.
import { USER_AGENT } from './politeFetch.js'

export type AddressSuggestion = { label: string; hasHouseNumber: boolean }

const PHOTON_URL = 'https://photon.komoot.io/api/'
const TIMEOUT_MS = 4_000
const MAX_SUGGESTIONS = 5
// The bounding box of Montana: west, south, east, north.
const MONTANA_BBOX = '-116.05,44.35,-104.03,49.01'

type PhotonProperties = {
  type?: string
  name?: string
  housenumber?: string
  street?: string
  city?: string
  town?: string
  village?: string
  state?: string
  postcode?: string
  countrycode?: string
}

/** Makes one suggestion from a Photon feature. Returns null for a feature that is not a Montana street or address. */
export function suggestionOf(p: PhotonProperties): AddressSuggestion | null {
  if (p.countrycode !== 'US' || p.state !== 'Montana') return null
  // A "house" feature has the street in `street`. A "street" feature has it in `name`.
  const street = p.type === 'street' ? p.name : p.street
  if (!street) return null
  const line = p.housenumber ? `${p.housenumber} ${street}` : street
  const place = p.city ?? p.town ?? p.village
  const stateZip = p.postcode ? `MT ${p.postcode}` : 'MT'
  return { label: [line, place, stateZip].filter(Boolean).join(', '), hasHouseNumber: Boolean(p.housenumber) }
}

/**
 * Reads a Photon response. Removes the duplicate labels.
 *
 * OpenStreetMap often has a street but not the house numbers on it. When the
 * typed text starts with a house number, a street without a number gets the
 * typed number. Then the Census Geocoder can find the full address.
 */
export function parsePhotonResponse(body: unknown, typed = ''): AddressSuggestion[] {
  const typedNumber = /^\s*(\d+[A-Za-z]?)\s/.exec(typed)?.[1]
  const features = (body as { features?: { properties?: PhotonProperties }[] })?.features
  if (!Array.isArray(features)) return []
  const seen = new Set<string>()
  const result: AddressSuggestion[] = []
  for (const f of features) {
    const p = f.properties
    const s = p ? suggestionOf(typedNumber && !p.housenumber ? { ...p, housenumber: typedNumber } : p) : null
    if (!s || seen.has(s.label)) continue
    seen.add(s.label)
    result.push(s)
    if (result.length === MAX_SUGGESTIONS) break
  }
  return result
}

// Results for the e2e suite, by typed text. The suite must not call the real
// service. The test route in server.ts sets these values. Production ignores them.
const stubs = new Map<string, AddressSuggestion[]>()

function stubKey(text: string): string {
  return text.trim().toLowerCase()
}

export function setAddressSuggestStub(text: string, suggestions: AddressSuggestion[]) {
  stubs.set(stubKey(text), suggestions)
}

/**
 * Returns a maximum of five Montana addresses that start with the text.
 * Returns an empty list when Photon fails: the suggestions are optional.
 */
export async function suggestAddresses(text: string): Promise<AddressSuggestion[]> {
  if (process.env.NODE_ENV !== 'production') {
    const key = stubKey(text)
    for (const [prefix, suggestions] of stubs) if (key.startsWith(prefix)) return suggestions
    // The e2e addresses must not go to the real service.
    if (key.includes('e2e')) return []
  }

  const url = new URL(PHOTON_URL)
  url.search = new URLSearchParams({ q: text, limit: '10', lang: 'en', bbox: MONTANA_BBOX }).toString()
  // Photon accepts the layer parameter more than one time.
  url.searchParams.append('layer', 'house')
  url.searchParams.append('layer', 'street')

  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      console.error(`address suggestions: Photon status ${res.status}`)
      return []
    }
    return parsePhotonResponse(await res.json(), text)
  } catch (err) {
    console.error(`address suggestions: Photon failed (${err instanceof Error ? err.name : 'error'})`)
    return []
  }
}
