import { test, expect, signUpFreshWorkspace, trackFirstAvailableBill } from './fixtures'
import type { Page } from '@playwright/test'

// Testimony attachments (issue #61). The download route puts the file name
// into the Content-Disposition header. The route also sends the stored MIME type.

async function draftTestimonyWithAttachment(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await signUpFreshWorkspace(page)
  await trackFirstAvailableBill(page)
  await page.click('button:has-text("+ Draft")')
  await page.setInputFiles('input[type="file"]', file)
  await page.click('button:has-text("Save draft")')
  const link = page.locator('a', { hasText: `📎 ${file.name}` })
  await expect(link).toBeVisible()
  return link
}

test.describe('testimony attachments', () => {
  test('a file name with characters outside ASCII downloads with the same name', async ({ page }) => {
    // Word often puts an en dash into a file name.
    const name = 'Testimony – final.pdf'
    const contents = Buffer.from('%PDF-1.4 E2E testimony attachment')
    const link = await draftTestimonyWithAttachment(page, { name, mimeType: 'application/pdf', buffer: contents })

    const downloadPromise = page.waitForEvent('download')
    await link.click()
    const download = await downloadPromise

    expect(await download.failure()).toBeNull()
    expect(download.suggestedFilename()).toBe(name)
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).equals(contents)).toBe(true)
  })

  test('an attachment of a type that is not on the list downloads as application/octet-stream with nosniff', async ({ page }) => {
    const link = await draftTestimonyWithAttachment(page, {
      name: 'statement.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<script>alert(1)</script>'),
    })

    const href = await link.getAttribute('href')
    const response = await page.request.get(new URL(href!, page.url()).toString())
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/octet-stream')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['content-disposition']).toBe(
      `attachment; filename="statement.html"; filename*=UTF-8''statement.html`,
    )
  })
})
