import { test, expect, signUpFreshWorkspace, uniqueSuffix } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

// The address search on the Legislators page (issue #69). The tests do not
// call the real Census Geocoder. Each test sets the result for its own
// address with a test-only route (server/src/addressLookup.ts).
const API_BASE = 'http://localhost:4000'

type Member = { id: string; name: string; chamber: 'house' | 'senate'; district: number; email: string | null }
type StubResult = 'no-match' | 'unavailable' | { matchedAddress: string; house: number; senate: number }

async function membersInData(request: APIRequestContext): Promise<{ house: Member; senate: Member }> {
  const res = await request.get(`${API_BASE}/api/public/legislators/map`)
  expect(res.ok()).toBeTruthy()
  const { members } = (await res.json()) as { members: Member[] }
  const house = members.find((m) => m.chamber === 'house')
  const senate = members.find((m) => m.chamber === 'senate')
  expect(house, 'the data has a House member').toBeTruthy()
  expect(senate, 'the data has a Senate member').toBeTruthy()
  return { house: house!, senate: senate! }
}

// A unique address for each test, so that tests that run at the same time do not share a result.
async function stubAddress(request: APIRequestContext, result: StubResult): Promise<string> {
  const address = `${Math.floor(Math.random() * 9000) + 100} E2E Street ${uniqueSuffix()}, Helena, MT`
  const res = await request.post(`${API_BASE}/api/__test__/address-lookup`, { data: { address, result } })
  expect(res.status()).toBe(204)
  return address
}

async function search(page: Page, address: string) {
  await page.getByLabel('Find my legislators', { exact: true }).fill(address)
  await page.getByRole('button', { name: 'Find', exact: true }).click()
}

test.describe('legislator address search', () => {
  test('an address shows its House and Senate members and outlines the House district on the map', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { house, senate } = await membersInData(page.request)
    const address = await stubAddress(page.request, {
      matchedAddress: '1301 E 6TH AVE, HELENA, MT, 59601',
      house: house.district,
      senate: senate.district,
    })

    await page.goto('/legislators')
    await search(page, address)

    const result = page.getByRole('region', { name: 'Your legislators' })
    await expect(result).toContainText('1301 E 6TH AVE, HELENA, MT, 59601')
    const houseCard = result.getByRole('listitem', { name: `House District ${house.district}` })
    await expect(houseCard.getByRole('link', { name: `Rep. ${house.name}` })).toHaveAttribute('href', `/legislators/${house.id}`)
    if (house.email) await expect(houseCard.getByRole('link', { name: house.email })).toHaveAttribute('href', `mailto:${house.email}`)
    const senateCard = result.getByRole('listitem', { name: `Senate District ${senate.district}` })
    await expect(senateCard.getByRole('link', { name: `Sen. ${senate.name}` })).toBeVisible()

    // The map outlines the House district and shows the district note.
    await expect(page).toHaveURL(new RegExp(`district=house-${house.district}`))
    await expect(page.locator('path[data-in-district]').first()).toBeVisible()
    await expect(page.getByLabel('District', { exact: true })).toContainText(`House District ${house.district}`)

    // The member link opens the legislator page.
    await houseCard.getByRole('link', { name: `Rep. ${house.name}` }).click()
    await expect(page).toHaveURL(new RegExp(`/legislators/${house.id}$`))
  })

  test('an address with no match shows a message', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const address = await stubAddress(page.request, 'no-match')

    await page.goto('/legislators')
    await search(page, address)

    await expect(page.getByRole('alert')).toContainText('No Montana address matches')
    await expect(page.getByRole('region', { name: 'Your legislators' })).toHaveCount(0)
  })

  test('a visitor who is not logged in can search an address', async ({ page }) => {
    const { house, senate } = await membersInData(page.request)
    const address = await stubAddress(page.request, { matchedAddress: 'VISITOR ADDRESS, MT', house: house.district, senate: senate.district })

    await page.goto('/legislators')
    await expect(page.getByRole('link', { name: 'Sign up free' })).toBeVisible()
    await search(page, address)

    const result = page.getByRole('region', { name: 'Your legislators' })
    await expect(result.getByRole('link', { name: `Rep. ${house.name}` })).toBeVisible()
    await expect(result.getByRole('link', { name: `Sen. ${senate.name}` })).toBeVisible()
  })

  test('a geocoder failure shows that the search is not available', async ({ page }) => {
    const address = await stubAddress(page.request, 'unavailable')

    await page.goto('/legislators')
    await search(page, address)

    await expect(page.getByRole('alert')).toContainText('The address search is not available now.')
  })

  test('Enter in the address field starts the search', async ({ page }) => {
    const { house, senate } = await membersInData(page.request)
    const address = await stubAddress(page.request, { matchedAddress: 'ENTER KEY ADDRESS, MT', house: house.district, senate: senate.district })

    await page.goto('/legislators')
    const field = page.getByRole('combobox', { name: 'Find my legislators' })
    await field.fill(address)
    await field.press('Enter')

    const result = page.getByRole('region', { name: 'Your legislators' })
    await expect(result).toContainText('ENTER KEY ADDRESS, MT')
    await expect(result.getByRole('link', { name: `Rep. ${house.name}` })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})

// Address suggestions from Photon (server/src/addressSuggest.ts). The tests
// set the suggestions for their own typed text with a test-only route.
test.describe('address suggestions', () => {
  async function stubSuggestions(request: APIRequestContext, text: string, suggestions: { label: string; hasHouseNumber: boolean }[]) {
    const res = await request.post(`${API_BASE}/api/__test__/address-suggestions`, { data: { text, suggestions } })
    expect(res.status()).toBe(204)
  }

  test('the arrow keys and Enter choose a suggestion, and a suggestion with a house number starts the search', async ({ page }) => {
    const { house, senate } = await membersInData(page.request)
    const full = await stubAddress(page.request, { matchedAddress: 'SUGGESTED ADDRESS, MT', house: house.district, senate: senate.district })
    const typed = `e2e typed ${uniqueSuffix()}`
    const street = `E2E Street Only ${uniqueSuffix()}, Helena, MT 59601`
    await stubSuggestions(page.request, typed, [
      { label: street, hasHouseNumber: false },
      { label: full, hasHouseNumber: true },
    ])

    await page.goto('/legislators')
    const field = page.getByRole('combobox', { name: 'Find my legislators' })
    await field.fill(typed)
    const list = page.getByRole('listbox', { name: 'Address suggestions' })
    await expect(list.getByRole('option')).toHaveText([street, full])

    await field.press('ArrowDown')
    await field.press('ArrowDown')
    await expect(list.getByRole('option', { name: full })).toHaveAttribute('aria-selected', 'true')
    await field.press('Enter')

    await expect(field).toHaveValue(full)
    await expect(list).toHaveCount(0)
    const result = page.getByRole('region', { name: 'Your legislators' })
    await expect(result).toContainText('SUGGESTED ADDRESS, MT')
    await expect(result.getByRole('link', { name: `Sen. ${senate.name}` })).toBeVisible()
  })

  test('a click on a street without a house number fills the field and does not search', async ({ page }) => {
    const typed = `e2e street ${uniqueSuffix()}`
    const street = `E2E Main Street ${uniqueSuffix()}, Bozeman, MT 59715`
    await stubSuggestions(page.request, typed, [{ label: street, hasHouseNumber: false }])

    await page.goto('/legislators')
    const field = page.getByRole('combobox', { name: 'Find my legislators' })
    await field.fill(typed)
    await page.getByRole('option', { name: street }).click()

    await expect(field).toHaveValue(street)
    await expect(page.getByRole('listbox', { name: 'Address suggestions' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Your legislators' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Find', exact: true })).toBeEnabled()
  })

  test('the map credits OpenStreetMap for the suggestions', async ({ page }) => {
    await page.goto('/legislators')
    await expect(page.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    )
  })
})
