// Gets the text of bill versions and amendments from the Legislature's
// document store, and writes a plain-language summary of each amendment.
//
// For each bill, the job:
//   1. Lists the version files and the amendment files.
//   2. Downloads the new files and extracts the text (src/billText.ts).
//   3. Compares each amendment with the bill version that it changes.
// Then it summarizes the new amendments with Claude and runs the alerts.
//
// A run checks a limited number of bills, the bills that need a check most:
//   - bills that the job has not checked,
//   - bills with a new status or a new amendment since the last check,
//   - bills of a session that is in progress, once a day.
// The first runs for a session check all its bills, a part in each run.
//
// Usage:
//   npm run refresh-bill-texts
//   npm run refresh-bill-texts -- --limit=50       # check at most 50 bills
//   npm run refresh-bill-texts -- --bill=1234       # check one bill (bills.id)
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { pool } from './db.js'
import * as api from './legmtClient.js'
import { runAlertsAfterScrape } from './alerts.js'
import { withScrapeMonitoring } from './scrapeHealth.js'
import { runWithConcurrency } from './concurrency.js'
import { isCredentialError } from './anthropicErrors.js'
import {
  changedParagraphs,
  describeChanges,
  diffParagraphs,
  extractBillText,
  parseAmendmentFileName,
  parseVersionFileName,
  type AmendmentFile,
  type ChangedParagraph,
  type Paragraph,
} from './billText.js'
import type { RawDocument } from './legmtTypes.js'

const TARGET_SESSION_ORDINALS = process.env.SCRAPE_SESSION_ORDINALS ?? '20251'
const DEFAULT_BILL_LIMIT = 300
const BILL_CONCURRENCY = 4
const SUMMARY_LIMIT = 150
const SUMMARY_CONCURRENCY = 3
export const SUMMARY_MODEL = 'claude-haiku-5-5'

const SYSTEM_PROMPT = `You explain amendments to Montana bills for policy staff. You get the paragraphs of the bill that the amendment changes.

Notation:
- [-text-] is text that the amendment removes. {+text+} is text that the amendment adds.
- <s>text</s> is struck text: the bill removes it from current law. <u>text</u> is underlined text: the bill adds it to the law.
- A word that changes from plain or underlined to <s>struck</s> is text that the amendment removes from the bill.
- Text in CAPITAL letters is text that a chamber added before.

Write 1 to 3 short sentences in plain language that tell what the amendment does to the bill. Write about the effect, not the wording. Give specific numbers, dates, and names from the text. If the amendment only changes references, numbering, or wording, say that it is a technical amendment. Be neutral. Do not say whether the amendment is good or bad. Write only the summary.`

interface BillToCheck {
  id: number
  identifier: string
  legislature_ordinal: number
  ordinals: string
  bill_type: string
  bill_number: number
}

function parseArgs() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  return {
    limit: Number(arg('limit') ?? DEFAULT_BILL_LIMIT),
    billId: arg('bill') ? Number(arg('bill')) : null,
  }
}

async function billsToCheck(limit: number, billId: number | null): Promise<BillToCheck[]> {
  const { rows } = await pool.query<BillToCheck>(
    `SELECT b.id, bt.code || ' ' || b.bill_number AS identifier, l.ordinal AS legislature_ordinal,
            s.ordinals, bt.code AS bill_type, b.bill_number
     FROM bills b
     JOIN sessions s ON s.id = b.session_id
     JOIN legislatures l ON l.id = s.legislature_id
     JOIN bill_types bt ON bt.id = b.bill_type_id
     WHERE b.bill_number IS NOT NULL
       AND ($2::int IS NOT NULL AND b.id = $2
         OR $2::int IS NULL AND s.ordinals = $1 AND (
              b.texts_checked_at IS NULL
           -- occurred_at is Montana time with no time zone.
           OR EXISTS (SELECT 1 FROM bill_statuses bs
                      WHERE bs.draft_id = b.draft_id
                        AND bs.occurred_at > (b.texts_checked_at AT TIME ZONE 'America/Denver') - interval '1 day')
           OR EXISTS (SELECT 1 FROM amendments a
                      WHERE a.bill_id = b.id AND a.first_seen_at > b.texts_checked_at)
           OR (s.sine_die_date IS NULL OR s.sine_die_date > now() - interval '7 days')
              AND b.texts_checked_at < now() - interval '1 day'))
     ORDER BY b.texts_checked_at NULLS FIRST, b.id
     LIMIT $3`,
    [TARGET_SESSION_ORDINALS, billId, limit],
  )
  return rows
}

/** The newest file of each group: the latest date, then the highest copy number. */
function newestBy<T>(docs: { doc: RawDocument; key: string; copy: number; info: T }[]) {
  const best = new Map<string, { doc: RawDocument; copy: number; info: T }>()
  for (const d of docs) {
    const current = best.get(d.key)
    const newer =
      !current ||
      (d.doc.date ?? '') > (current.doc.date ?? '') ||
      ((d.doc.date ?? '') === (current.doc.date ?? '') && d.copy > current.copy)
    if (newer) best.set(d.key, d)
  }
  return best
}

const postedAt = (doc: RawDocument) => doc.date ?? doc.creation ?? null

async function refreshBill(bill: BillToCheck): Promise<{ versions: number; amendments: number }> {
  const ref = {
    legislatureOrdinal: bill.legislature_ordinal,
    sessionOrdinals: bill.ordinals,
    billType: bill.bill_type,
    billNumber: bill.bill_number,
  }
  const [versionDocs, amendmentDocs] = await Promise.all([
    api.getBillVersionDocuments(ref),
    api.getBillAmendmentDocuments(ref),
  ])

  // Versions.
  const { rows: storedVersions } = await pool.query<{ id: number; version_key: string; paragraphs: Paragraph[] }>(
    `SELECT id, version_key, paragraphs FROM bill_text_versions WHERE bill_id = $1`,
    [bill.id],
  )
  const texts = new Map(storedVersions.map((v) => [v.version_key, v.paragraphs]))
  const storedIds = new Set(storedVersions.map((v) => v.id))
  const versions = newestBy(
    versionDocs.flatMap((doc) => {
      const parsed = parseVersionFileName(doc.fileName)
      return parsed ? [{ doc, key: parsed.key, copy: parsed.copy, info: null }] : []
    }),
  )
  let newVersions = 0
  for (const [key, { doc }] of versions) {
    if (storedIds.has(doc.id)) continue
    const paragraphs = await extractBillText(await api.getDocumentContent(doc.id))
    await pool.query(
      `INSERT INTO bill_text_versions (id, bill_id, version_key, file_name, posted_at, paragraphs)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (bill_id, version_key) DO UPDATE
         SET id = $1, file_name = $4, posted_at = $5, paragraphs = $6, fetched_at = now()`,
      [doc.id, bill.id, key, doc.fileName, postedAt(doc), JSON.stringify(paragraphs)],
    )
    texts.set(key, paragraphs)
    newVersions += 1
  }

  // Amendments. The "condensed" file has only the changed pages, so use the
  // full file.
  const { rows: storedAmendments } = await pool.query<{ id: number; has_changes: boolean }>(
    `SELECT id, changes IS NOT NULL AS has_changes FROM amendment_documents WHERE bill_id = $1`,
    [bill.id],
  )
  const done = new Set(storedAmendments.filter((a) => a.has_changes).map((a) => a.id))
  const amendments = newestBy<AmendmentFile>(
    amendmentDocs.flatMap((doc) => {
      const parsed = parseAmendmentFileName(doc.fileName)
      if (!parsed || parsed.kind === 'condensed') return []
      return [{ doc, key: parsed.base, copy: parsed.copy, info: parsed }]
    }),
  )
  let newAmendments = 0
  for (const { doc, info } of amendments.values()) {
    if (done.has(doc.id)) continue
    const base = texts.get(String(info.billVersion))
    let changes: ChangedParagraph[] | null = null
    if (base) {
      const inContext = await extractBillText(await api.getDocumentContent(doc.id))
      changes = changedParagraphs(diffParagraphs(base, inContext))
    }
    await pool.query(
      `INSERT INTO amendment_documents
         (id, bill_id, amendment_id, base_name, bill_version, number, section, file_name, posted_at, changes)
       VALUES ($1, $2,
         (SELECT a.id FROM amendments a
          WHERE a.bill_id = $2 AND a.bill_version = $4 AND a.number = $5
            AND ($6::text IS NULL OR a.section = $6)
          ORDER BY (a.section = $6) DESC NULLS LAST, a.id LIMIT 1),
         $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (bill_id, base_name) DO UPDATE
         SET id = $1, amendment_id = EXCLUDED.amendment_id, file_name = $7, posted_at = $8, changes = $9,
             -- A new file of the amendment needs a new summary.
             summary = CASE WHEN amendment_documents.id = $1 THEN amendment_documents.summary END,
             summarized_at = CASE WHEN amendment_documents.id = $1 THEN amendment_documents.summarized_at END,
             fetched_at = now()`,
      [
        doc.id,
        bill.id,
        info.base,
        info.billVersion,
        info.number,
        info.section,
        doc.fileName,
        postedAt(doc),
        changes ? JSON.stringify(changes) : null,
      ],
    )
    if (changes) newAmendments += 1
  }

  await pool.query(`UPDATE bills SET texts_checked_at = now() WHERE id = $1`, [bill.id])
  return { versions: newVersions, amendments: newAmendments }
}

const NO_CHANGE_SUMMARY = 'This amendment makes no change to the bill text.'

async function summarizeAmendments(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set: no amendment summaries.')
    return 0
  }
  const { rows } = await pool.query<{ id: number; identifier: string; title: string | null; changes: ChangedParagraph[] }>(
    `SELECT ad.id, bt.code || ' ' || b.bill_number AS identifier, d.short_title AS title, ad.changes
     FROM amendment_documents ad
     JOIN bills b ON b.id = ad.bill_id
     JOIN bill_types bt ON bt.id = b.bill_type_id
     JOIN drafts d ON d.id = b.draft_id
     WHERE ad.changes IS NOT NULL AND ad.summary IS NULL
     ORDER BY ad.posted_at DESC NULLS LAST
     LIMIT $1`,
    [SUMMARY_LIMIT],
  )
  // See identifySpeakers.ts: an API key that is not scoped to a workspace
  // needs the workspace header.
  const client = new Anthropic({
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
      ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
      : undefined,
  })
  let count = 0
  let failed = 0
  let badKey = false
  await runWithConcurrency(rows, SUMMARY_CONCURRENCY, async (row) => {
    // With a bad API key, all calls fail. Stop after the first one.
    if (badKey) return
    let summary = NO_CHANGE_SUMMARY
    let model: string | null = null
    if (row.changes.length > 0) {
      try {
        const response = await client.messages.create({
          model: SUMMARY_MODEL,
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Bill: ${row.identifier}${row.title ? `, "${row.title}"` : ''}\n\nChanged paragraphs:\n\n${describeChanges(row.changes)}`,
            },
          ],
        })
        summary = response.content
          .flatMap((b) => (b.type === 'text' ? [b.text] : []))
          .join('')
          .trim()
        model = SUMMARY_MODEL
      } catch (err) {
        failed += 1
        console.error(`summary failed for amendment document ${row.id}:`, err instanceof Error ? err.message : err)
        if (isCredentialError(err)) {
          badKey = true
          console.error('the Anthropic API key is not valid: stopping the summaries. Fix ANTHROPIC_API_KEY.')
        }
        return
      }
    }
    if (!summary) return
    await pool.query(
      `UPDATE amendment_documents SET summary = $2, summary_model = $3, summarized_at = now() WHERE id = $1`,
      [row.id, summary, model],
    )
    count += 1
  })
  // A failed summary ends the run with an error (see main), so that Railway
  // shows the run as failed. The next run tries the summary again.
  if (failed > 0) process.exitCode = 1
  return count
}

async function main() {
  const { limit, billId } = parseArgs()
  const bills = await billsToCheck(limit, billId)
  let versions = 0
  let amendments = 0
  let failed = 0
  await runWithConcurrency(bills, BILL_CONCURRENCY, async (bill) => {
    try {
      const result = await refreshBill(bill)
      versions += result.versions
      amendments += result.amendments
    } catch (err) {
      // The next run checks the bill again. The scrape health checks count
      // the failed requests.
      failed += 1
      console.error(`${bill.identifier}:`, err instanceof Error ? err.message : err)
    }
  })
  console.log(
    `checked ${bills.length - failed} bills: ${versions} new versions, ${amendments} new amendments` +
      (failed ? `, ${failed} failed` : ''),
  )
  const summaries = await summarizeAmendments()
  console.log(`summarized ${summaries} amendments`)
  await runAlertsAfterScrape()
}

withScrapeMonitoring('refresh-bill-texts', main)
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
