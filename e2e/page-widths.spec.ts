import { test, expect, signUpFreshWorkspace } from './fixtures'

// A wide screen. Before the page width tokens, the map card stopped at about
// 840 px and the bill table stopped at 1080 px, with empty space on the right.
test.use({ viewport: { width: 1880, height: 1000 } })

test.describe('page widths on a wide screen', () => {
  test('the county map and the bill table use the width of the main area', async ({ page }) => {
    await signUpFreshWorkspace(page)

    await page.goto('/legislators')
    const map = page.getByRole('img', { name: 'Map of the Montana counties' })
    await expect(map).toBeVisible()
    const mapBox = await map.boundingBox()
    expect(mapBox!.width).toBeGreaterThan(1000)
    // The county panel stays next to the map, on the right.
    const panelBox = await page.getByRole('complementary', { name: 'County details' }).boundingBox()
    expect(panelBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width - 1)

    await page.goto('/bills')
    const table = page.getByRole('table', { name: 'Bills' })
    await expect(table).toBeVisible()
    expect((await table.boundingBox())!.width).toBeGreaterThan(1300)
  })

  test('the settings page keeps a width that is easy to read', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/settings')
    const heading = page.getByRole('heading', { name: 'Settings', level: 1 })
    await expect(heading).toBeVisible()
    const pageBox = await heading.locator('xpath=ancestor::div[contains(@class, "page")][1]').boundingBox()
    expect(pageBox!.width).toBeLessThanOrEqual(960)
  })
})
