import {
  test,
  expect,
  signUpFreshWorkspace,
  trackFirstAvailableBill,
  createHearingFixture,
  type HearingFixtureSegment,
} from './fixtures'

const API_BASE = 'http://localhost:4000'

// Hearing fixtures are global rows (not workspace-scoped), and the
// dashboard player shows whichever recording is newest. Serial, so one
// test's fixture can't displace another's mid-test. No other spec file
// creates recordings.
test.describe.configure({ mode: 'serial' })

const SPEAKERS = [
  { label: 'S1', displayName: 'Sen. Jane Example' },
  { label: 'S2', displayName: 'Speaker 1' },
]

function segments(extra: HearingFixtureSegment[] = []): HearingFixtureSegment[] {
  return [
    { start: 5, end: 40, speakerLabel: 'S1', text: 'I will call the committee to order. Secretary, please call the roll.' },
    {
      start: 41,
      end: 95,
      speakerLabel: 'S2',
      text: 'Thank you, Madam Chair. For the record, my name is Pat Witness and I am here on the property tax study.',
    },
    { start: 300, end: 360, speakerLabel: 'S1', text: 'Thank you. We will now move to agency monitoring.' },
    ...extra,
  ]
}

const transcriptLines = (page: import('@playwright/test').Page) => page.locator('ol[aria-label="Transcript"] > li')

test.describe('hearing transcript page', () => {
  test('shows a timestamped, speaker-attributed transcript; clicking a line seeks the player there', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const hearing = await createHearingFixture(page.request, { durationSeconds: 1500, speakers: SPEAKERS, segments: segments() })

    await page.goto(`/hearings/recordings/${hearing.id}`)
    await expect(page.locator('h1', { hasText: hearing.committee })).toBeVisible()
    await expect(page.locator('text=Speaker-attributed transcript')).toBeVisible()
    await expect(transcriptLines(page)).toHaveCount(3)
    await expect(transcriptLines(page).nth(0)).toContainText('0:05')
    await expect(transcriptLines(page).nth(0)).toContainText('Sen. Jane Example')
    await expect(transcriptLines(page).nth(1)).toContainText('Speaker 1')

    const clock = page.getByTestId('player-clock')
    const slider = page.getByRole('slider', { name: 'Seek' })
    await expect(clock).toHaveText('0:00 / 25:00')

    await transcriptLines(page).nth(2).getByRole('button', { name: /agency monitoring/ }).click()
    await expect(clock).toHaveText('5:00 / 25:00')
    await expect(slider).toHaveAttribute('aria-valuenow', '300')
    await expect(transcriptLines(page).nth(2)).toHaveAttribute('aria-current', 'true')

    await transcriptLines(page).nth(1).getByRole('button', { name: /Pat Witness/ }).click()
    await expect(clock).toHaveText('0:41 / 25:00')
    await expect(transcriptLines(page).nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(transcriptLines(page).nth(2)).not.toHaveAttribute('aria-current', 'true')
  })

  test('search and the speaker filter narrow the transcript', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const hearing = await createHearingFixture(page.request, { speakers: SPEAKERS, segments: segments() })

    await page.goto(`/hearings/recordings/${hearing.id}`)
    await expect(transcriptLines(page)).toHaveCount(3)

    await page.fill('input[placeholder="Search transcript"]', 'property tax')
    await expect(transcriptLines(page)).toHaveCount(1)
    await expect(transcriptLines(page).first()).toContainText('Pat Witness')
    await expect(page.locator('text=1 of 3 lines')).toBeVisible()

    await page.fill('input[placeholder="Search transcript"]', '')
    await page.getByLabel('Filter by speaker').selectOption('Sen. Jane Example')
    await expect(transcriptLines(page)).toHaveCount(2)
    await expect(transcriptLines(page).filter({ hasText: 'Speaker 1' })).toHaveCount(0)
  })

  test('Clip on a real transcript segment saves an attributed note pointing back to that moment', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const hearing = await createHearingFixture(page.request, { speakers: SPEAKERS, segments: segments() })

    await page.goto(`/hearings/recordings/${hearing.id}`)
    await transcriptLines(page).nth(2).getByRole('button', { name: 'Clip 5:00 to notes' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Clipped 5:00–6:00 to notes.' })).toBeVisible()

    await page.goto('/notes')
    const note = page.locator('div[class^="_note_"]', { hasText: 'agency monitoring' })
    await expect(note).toContainText('Sen. Jane Example: “Thank you. We will now move to agency monitoring.”')
    await expect(note).toContainText(`From: ${hearing.committee},`)
    await expect(note).toContainText('5:00–6:00')
  })

  test('a captions-only recording says so and shows no speaker names', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const hearing = await createHearingFixture(page.request, {
      status: 'processing',
      segments: [
        { start: 318, end: 345, text: 'call the interim committee on thank you Mr Chair' },
        { start: 347, end: 372, text: 'all right looks like we have a voted levies and bond study' },
      ],
    })

    await page.goto(`/hearings/recordings/${hearing.id}`)
    await expect(page.locator('text=Captions only · speaker transcript in progress')).toBeVisible()
    await expect(page.locator('text=These are the Legislature’s live captions')).toBeVisible()
    await expect(transcriptLines(page)).toHaveCount(2)
    await expect(page.getByLabel('Filter by speaker')).toHaveCount(0)

    await transcriptLines(page).nth(1).getByRole('button', { name: /voted levies/ }).click()
    await expect(page.getByTestId('player-clock')).toHaveText(/^5:47 \//)
  })

  test('lines that mention one of the workspace’s tracked bills are flagged', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const { identifier } = await trackFirstAvailableBill(page)
    const hearing = await createHearingFixture(page.request, {
      speakers: SPEAKERS,
      segments: segments([{ start: 400, end: 430, speakerLabel: 'S2', text: `I want to speak to ${identifier} for a moment.` }]),
    })

    await page.goto(`/hearings/recordings/${hearing.id}`)
    await expect(transcriptLines(page)).toHaveCount(4)
    await expect(transcriptLines(page).filter({ hasText: 'Mentions a tracked bill' })).toHaveCount(1)
    await expect(transcriptLines(page).filter({ hasText: 'Mentions a tracked bill' })).toContainText(identifier)
  })

  test('a transcript whose speakers have no names yet is not labeled speaker-attributed', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const hearing = await createHearingFixture(page.request, {
      speakers: [
        { label: 'S1', displayName: 'Speaker 1' },
        { label: 'S2', displayName: 'Speaker 2' },
      ],
      segments: [
        { start: 5, end: 40, speakerLabel: 'S1', text: 'I call the committee to order.' },
        { start: 41, end: 60, speakerLabel: 'S2', text: 'Thank you, Madam Chair.' },
      ],
    })

    await page.goto(`/hearings/recordings/${hearing.id}`)
    await expect(page.locator('text=Transcript · speakers not named yet')).toBeVisible()
    await expect(page.locator('text=Speaker-attributed transcript')).toHaveCount(0)

    await page.goto('/hearings')
    const row = page.getByRole('region', { name: 'Recent recordings' }).locator(`a[href="/hearings/recordings/${hearing.id}"]`)
    await expect(row).toContainText('Transcript · speakers not named yet')
  })

  test('an unknown hearing id shows a not-found state', async ({ page }) => {
    await signUpFreshWorkspace(page)
    await page.goto('/hearings/recordings/99999999')
    await expect(page.locator('text=This hearing recording couldn’t be found.')).toBeVisible()
  })
})

test.describe('hearing audio on the dashboard', () => {
  test('plays the newest recording, opens its full transcript, and clips the current segment', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const hearing = await createHearingFixture(page.request, { speakers: SPEAKERS, segments: segments() })

    // Rendering the player must not touch the stream: every dashboard visit
    // renders it, and the stream proxies through to the Legislature's archive.
    const audioRequests: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/audio/')) audioRequests.push(r.url())
    })

    await page.goto('/')
    const card = page.locator(`[aria-label="${hearing.committee} hearing audio player"]`)
    await expect(card).toBeVisible()
    await expect(card).toContainText('Speaker-attributed transcript')
    await expect(card).toContainText('Sen. Jane Example')
    await page.waitForLoadState('networkidle')
    expect(audioRequests).toEqual([])

    // Searching marks matches; Next jumps the player to one, and the excerpt follows.
    await card.locator('input[placeholder="Search transcript"]').fill('agency')
    await expect(card.locator('text=1/1')).toBeVisible()
    await card.getByRole('button', { name: 'Next match' }).click()
    await expect(card.getByTestId('player-clock')).toHaveText('5:00 / 10:00')
    await expect(card).toContainText('We will now move to agency monitoring.')

    await card.getByRole('button', { name: 'Clip → notes' }).click()
    await expect(page.locator('text=Clipped 5:00–6:00 to notes.')).toBeVisible()

    // Play is what loads the stream; the fixture's points nowhere, so the
    // player reports it instead of failing silently.
    await card.getByRole('button', { name: 'Play' }).click()
    await expect.poll(() => audioRequests.length).toBeGreaterThan(0)
    await expect(card.locator('text=The recording couldn’t be loaded')).toBeVisible({ timeout: 20_000 })

    await card.getByRole('button', { name: 'Full transcript' }).click()
    await page.waitForURL(`/hearings/recordings/${hearing.id}`)
    await expect(page.locator('h1', { hasText: hearing.committee })).toBeVisible()
  })
})

test.describe('recordings on the Hearings page', () => {
  test('lists recent recordings with their transcript status, linking to the transcript', async ({ page }) => {
    await signUpFreshWorkspace(page)
    const hearing = await createHearingFixture(page.request, { speakers: SPEAKERS, segments: segments() })

    await page.goto('/hearings')
    const section = page.getByRole('region', { name: 'Recent recordings' })
    const link = section.locator(`a[href="/hearings/recordings/${hearing.id}"]`)
    await expect(link).toBeVisible()
    await expect(link).toContainText('Speaker-attributed transcript')

    await link.click()
    await page.waitForURL(`/hearings/recordings/${hearing.id}`)
    await expect(transcriptLines(page)).toHaveCount(3)
  })
})

test.describe('hearing audio proxy', () => {
  test('requires a session and only serves stream files inside the recording’s own directory', async ({ page }) => {
    const hearing = await createHearingFixture(page.request, { segments: segments() })

    const anonymous = await page.request.get(`${API_BASE}/api/hearings/${hearing.id}/audio/audio.m3u8`)
    expect(anonymous.status()).toBe(401)

    await signUpFreshWorkspace(page)
    const get = (path: string) => page.request.get(`${API_BASE}/api/hearings/${hearing.id}/audio/${path}`)
    expect((await get('..%2F..%2Fsecret.m3u8')).status()).toBe(404)
    expect((await get('index.html')).status()).toBe(404)
    expect((await page.request.get(`${API_BASE}/api/hearings/99999999/audio/audio.m3u8`)).status()).toBe(404)
    // A legitimate path is forwarded upstream — the fixture's stream points at
    // a closed port, so that surfaces as a gateway error, not a 404.
    expect((await get('audio.m3u8')).status()).toBe(502)
  })
})
