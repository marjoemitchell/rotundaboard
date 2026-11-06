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
})
