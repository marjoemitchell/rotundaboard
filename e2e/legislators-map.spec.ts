import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'
import type { Page } from '@playwright/test'

const API_BASE = 'http://localhost:4000'

type MapData = {
  counties: { fips: string; name: string; house: number[]; senate: number[] }[]
  members: {
    id: string
    name: string
    chamber: 'house' | 'senate'
    district: number
    email: string | null
    homeCounty: string | null
    trackedSponsored: number
  }[]
}

async function mapData(page: Page): Promise<MapData> {
  const res = await page.request.get(`${API_BASE}/api/legislators/map`)
  expect(res.ok()).toBeTruthy()
  return res.json()
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'County details' })

test.describe('legislators map', () => {
  test('the legislators page is a county map; a county shows its House and Senate members', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const data = await mapData(page)
    expect(data.counties).toHaveLength(56)
    // Every district has its current member.
    expect(data.members.filter((m) => m.chamber === 'house')).toHaveLength(100)
    expect(data.members.filter((m) => m.chamber === 'senate')).toHaveLength(50)

    await page.goto('/legislators')
    await expect(page.locator('h1', { hasText: 'Legislators by county' })).toBeVisible()
    await expect(page.locator('path[data-county]')).toHaveCount(56)
    await expect(panel(page)).toContainText('No county selected')

    // Hover shows a county. Click pins it.
    const yellowstone = data.counties.find((c) => c.name === 'Yellowstone')!
    await page.locator('path[data-county="Yellowstone"]').hover()
    await expect(panel(page)).toContainText('Yellowstone County')
    await expect(panel(page)).toContainText('Click to pin')
    await page.locator('path[data-county="Yellowstone"]').click()
    await page.mouse.move(0, 0)
    await expect(panel(page)).toContainText('Pinned county')
    await expect(panel(page)).toContainText(`${yellowstone.house.length} House districts · ${yellowstone.senate.length} Senate districts`)
    await expect(panel(page).getByRole('list', { name: 'House members' }).getByRole('listitem')).toHaveCount(yellowstone.house.length)
    await expect(panel(page).getByRole('list', { name: 'Senate members' }).getByRole('listitem')).toHaveCount(yellowstone.senate.length)

    // The chamber switch hides the other chamber.
    await page.getByRole('group', { name: 'Chamber' }).getByRole('button', { name: 'Senate' }).click()
    await expect(panel(page).getByRole('list', { name: 'House members' })).toHaveCount(0)
    await expect(panel(page).getByRole('list', { name: 'Senate members' }).getByRole('listitem')).toHaveCount(yellowstone.senate.length)

    // A member name opens the legislator page.
    const first = panel(page).getByRole('list', { name: 'Senate members' }).getByRole('link').first()
    await first.click()
    await expect(page).toHaveURL(/\/legislators\/\d+$/)
  })

  test('the county menu selects a county without a mouse, and the shading and counts show tracked sponsors', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await trackFirstAvailableBill(page)
    const data = await mapData(page)
    const sponsor = data.members.find((m) => m.trackedSponsored > 0)
    test.skip(!sponsor, 'the tracked bill has no current sponsor')
    const county = data.counties.find((c) => (sponsor!.chamber === 'house' ? c.house : c.senate).includes(sponsor!.district))!

    await page.goto('/legislators')
    await page.getByLabel('County', { exact: true }).selectOption({ label: county.name })
    await expect(panel(page)).toContainText(`${county.name} County`)
    const row = panel(page).getByRole('listitem').filter({ hasText: sponsor!.name })
    await expect(row).toContainText('1tracked')
    // The county with a tracked sponsor is not the "None" color.
    const fill = await page.locator(`path[data-county="${county.name}"]`).evaluate((el) => el.getAttribute('style') ?? '')
    await page.getByLabel('County', { exact: true }).selectOption('')
    await page.mouse.move(0, 0)
    const unselectedFill = await page.locator(`path[data-county="${county.name}"]`).evaluate((el) => getComputedStyle(el).fill)
    expect(unselectedFill).not.toBe('rgb(232, 237, 243)')
    expect(fill).toContain('accent')
  })

  test('"Export contacts" downloads a CSV of the county members, and "Email the delegation" opens an email to them', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const data = await mapData(page)
    const county = data.counties.find((c) => c.name === 'Petroleum')!
    await page.goto('/legislators')
    await page.getByLabel('County', { exact: true }).selectOption({ label: county.name })

    const [download] = await Promise.all([page.waitForEvent('download'), panel(page).getByRole('button', { name: 'Export contacts' }).click()])
    expect(download.suggestedFilename()).toBe('petroleum-county-legislators.csv')
    const csv = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Name,Chamber,District,Party,Email,Committees')
    expect(lines).toHaveLength(1 + county.house.length + county.senate.length)

    const emails = data.members
      .filter((m) => (m.chamber === 'house' ? county.house : county.senate).includes(m.district) && m.email)
      .map((m) => m.email!)
    const href = await panel(page).getByRole('link', { name: 'Email the delegation' }).getAttribute('href')
    expect(decodeURIComponent(href!.replace('mailto:?bcc=', '')).split(',').sort()).toEqual(emails.sort())
  })

  test('the Map and List switch moves between the map and the list with search', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/legislators')
    const views = page.getByRole('navigation', { name: 'Legislators view' })
    await expect(views.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
    await views.getByRole('link', { name: 'List' }).click()
    await expect(page).toHaveURL(/\/legislators\/list$/)
    await expect(page.getByPlaceholder('Search by name or district')).toBeVisible()
    await expect(page.locator('nav[aria-label="Primary"]').getByRole('button', { name: 'Legislators' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('navigation', { name: 'Legislators view' }).getByRole('link', { name: 'Map' }).click()
    await expect(page.locator('path[data-county]')).toHaveCount(56)
  })
})

test.describe('district link on a legislator page', () => {
  test('the district opens the map with its main county pinned and its member marked', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const data = (await mapData(page)) as MapData & { districts: { house: Record<string, string[]>; senate: Record<string, string[]> } }
    // A Senate district with more than one county.
    const [number, fipsList] = Object.entries(data.districts.senate).find(([, list]) => list.length > 1)!
    const member = data.members.find((m) => m.chamber === 'senate' && m.district === Number(number))!
    const names = fipsList.map((f) => data.counties.find((c) => c.fips === f)!.name)

    await page.goto(`/legislators/${member.id}`)
    await page.getByRole('link', { name: new RegExp(`SENATE DISTRICT ${number}$`, 'i') }).click()
    await expect(page).toHaveURL(new RegExp(`/legislators\\?district=senate-${number}$`))

    const note = panel(page).getByLabel('District')
    await expect(note).toContainText(`Senate District ${number}`)
    await expect(note).toContainText(member.name)
    await expect(note).toContainText(`Covers parts of ${names.length} counties`)
    // The member's home county is pinned when it is in the district, else the
    // county with the largest part of the district.
    const pinnedName = member.homeCounty && names.includes(member.homeCounty) ? member.homeCounty : names[0]
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(`${pinnedName} County`)
    await expect(page.getByRole('group', { name: 'Chamber' }).getByRole('button', { name: 'Senate' })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel(page).locator('li[aria-current="true"]')).toContainText(member.name)
    await expect(page.locator('path[data-in-district]')).toHaveCount(names.length)

    // Another county of the district.
    const other = names.find((n) => n !== pinnedName)!
    await note.getByRole('button', { name: other, exact: true }).click()
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(`${other} County`)
    await expect(panel(page).locator('li[aria-current="true"]')).toContainText(member.name)

    // Clear removes the district.
    await note.getByRole('button', { name: 'Clear ×' }).click()
    await expect(page).toHaveURL(/\/legislators$/)
    await expect(page.locator('path[data-in-district]')).toHaveCount(0)
  })
})

test.describe('legislator contact', () => {
  test('a legislator page has email and phone links and the home town', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const data = await mapData(page)
    // A current member with a phone number in the profile data.
    let found: { id: string; email: string; phone: string; city: string; homeCounty: string | null } | null = null
    for (const m of data.members.slice(0, 40)) {
      const detail = await (await page.request.get(`${API_BASE}/api/legislators/${m.id}`)).json()
      if (detail.phone && detail.email && detail.city) {
        found = { id: m.id, email: detail.email, phone: detail.phone, city: detail.city, homeCounty: detail.homeCounty }
        break
      }
    }
    test.skip(!found, 'no legislator with contact data (run "npm run scrape")')

    await page.goto(`/legislators/${found!.id}`)
    const contact = page.getByRole('list', { name: 'Contact' })
    await expect(contact.getByRole('link', { name: found!.email })).toHaveAttribute('href', `mailto:${found!.email}`)
    await expect(contact.getByRole('link', { name: found!.phone })).toHaveAttribute('href', `tel:${found!.phone.replace(/[^\d+]/g, '')}`)
    await expect(contact).toContainText(found!.homeCounty ? `${found!.city}, ${found!.homeCounty} County` : found!.city)
  })
})
