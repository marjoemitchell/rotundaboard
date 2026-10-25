// Batch job: writes a short plain-language summary of each bill with the
// Claude Batch API.
//
// A bill with stored text (bill_text_versions, from refreshBillTexts.ts) gets
// a summary of its newest version. A bill with no text yet (for example a
// new LC draft) gets a summary of its metadata: title, subject, sponsor, and
// status. bill_summaries.source tells which, and the app shows it next to
// the summary. A bill gets a new summary when a newer version arrives.
//
// Usage:
//   npm run generate-summaries                     # bills with no summary or a newer version
//   npm run generate-summaries -- --force          # all bills again
//   npm run generate-summaries -- --session=20251  # one session only
//   npm run generate-summaries -- --limit=20       # at most 20 bills
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { pool } from './db.js'
import { markedText, versionLabel, type Paragraph } from './billText.js'

const MODEL = 'claude-haiku-5-5'
const MAX_TOKENS = 300

// The bill text of a long bill (for example the budget, HB 2) is cut at this
// length: about 30,000 tokens.
const MAX_TEXT_CHARS = 120_000

const TEXT_SYSTEM_PROMPT = `You summarize Montana legislative bills for policy staff at an advocacy nonprofit. You get the bill's metadata and its text.

In the bill text, <s>struck text</s> is removed from current law, and <u>underlined text</u> is added to the law. Text with no tags is current law that the bill keeps, or the bill's own sections.

Write a 2-3 sentence, neutral, factual summary of what the bill does: the main changes to the law, who or what they affect, and important numbers, dates, or amounts. Use only the text. If the text is cut, summarize the part you have and do not guess the rest. Do not editorialize about whether the bill is good or bad policy. Output only the summary text, no preamble.`

const SYSTEM_PROMPT = `You summarize Montana legislative bills for policy staff at an advocacy nonprofit. You are given only structured metadata about a bill — its title, subject area, sponsor, chamber, and current status — never the actual bill text.

Write a 2-3 sentence, neutral, factual summary of what the bill most likely does, based only on the metadata given. Do not invent specific provisions, numbers, or effects the metadata doesn't support — if the title is vague, say what's known (subject area, sponsor's apparent intent) rather than guessing at mechanics. If the bill died, was tabled, or became law, you may note that outcome briefly. Do not editorialize about whether the bill is good or bad policy. Output only the summary text, no preamble.`

interface SummaryCandidate {
  bill_id: number
  identifier: string
  short_title: string
  subject: string | null
  sponsor_name: string | null
  sponsor_party: string | null
  sponsor_district: string | null
  chamber: string | null
  status_name: string | null
  status_occurred_at: string | null
  /** The newest stored version of the bill text, or null. */
  version_id: number | null
  version_key: string | null
  version_posted_at: string | null
  paragraphs: Paragraph[] | null
}

async function getCandidates(
  force: boolean,
  sessionOrdinals: string | null,
  limit: number | null,
): Promise<SummaryCandidate[]> {
  const params: (string | number)[] = []
  if (sessionOrdinals) params.push(sessionOrdinals)
  const sessionParamIndex = sessionOrdinals ? params.length : null
  if (limit) params.push(limit)
  const limitParamIndex = limit ? params.length : null

  const { rows } = await pool.query<SummaryCandidate>(
    `
    SELECT
      b.id AS bill_id,
      CASE WHEN bt.code IS NOT NULL AND b.bill_number IS NOT NULL
        THEN bt.code || ' ' || b.bill_number
        ELSE regexp_replace(d.draft_number, '^([A-Za-z]+)(\\d+)$', '\\1 \\2')
      END AS identifier,
      d.short_title,
      subj.description AS subject,
      (sp.first_name || ' ' || sp.last_name) AS sponsor_name,
      pp.code AS sponsor_party,
      dist.name AS sponsor_district,
      bt.chamber,
      latest_status.status_name,
      latest_status.occurred_at AS status_occurred_at,
      v.id AS version_id, v.version_key, v.posted_at AS version_posted_at, v.paragraphs
    FROM bills b
    JOIN drafts d ON d.id = b.draft_id
    JOIN sessions s ON s.id = b.session_id
    LEFT JOIN bill_types bt ON bt.id = b.bill_type_id
    LEFT JOIN legislators sp ON sp.id = b.sponsor_id
    LEFT JOIN districts dist ON dist.id = sp.district_id
    LEFT JOIN political_parties pp ON pp.id = sp.political_party_id
    LEFT JOIN LATERAL (
      SELECT subj.description
      FROM draft_subjects ds JOIN subject_codes subj ON subj.id = ds.subject_code_id
      WHERE ds.draft_id = d.id AND ds.is_primary = true
      ORDER BY ds.subject_code_id LIMIT 1
    ) subj ON true
    LEFT JOIN LATERAL (
      SELECT bsc.name AS status_name, bs.occurred_at
      FROM bill_statuses bs LEFT JOIN bill_status_codes bsc ON bsc.id = bs.bill_status_code_id
      WHERE bs.draft_id = d.id ORDER BY bs.occurred_at DESC LIMIT 1
    ) latest_status ON true
    -- The newest version: X (enrolled) is the last.
    LEFT JOIN LATERAL (
      SELECT tv.id, tv.version_key, tv.posted_at, tv.paragraphs
      FROM bill_text_versions tv
      WHERE tv.bill_id = b.id
      ORDER BY CASE WHEN tv.version_key = 'X' THEN 1000 ELSE tv.version_key::int END DESC
      LIMIT 1
    ) v ON true
    LEFT JOIN bill_summaries bsum ON bsum.bill_id = b.id
    WHERE 1=1
      -- No summary, or a newer version than the one that was summarized.
      ${force ? '' : 'AND (bsum.bill_id IS NULL OR (v.id IS NOT NULL AND bsum.text_version_id IS DISTINCT FROM v.id))'}
      ${sessionParamIndex ? `AND s.ordinals = $${sessionParamIndex}` : ''}
    ORDER BY b.id
    ${limitParamIndex ? `LIMIT $${limitParamIndex}` : ''}
    `,
    params,
  )
  return rows
}

function buildTextPrompt(c: SummaryCandidate): string {
  let text = markedText(c.paragraphs ?? [])
  const cut = text.length > MAX_TEXT_CHARS
  if (cut) text = text.slice(0, MAX_TEXT_CHARS)
  return [
    buildPrompt(c),
    `Version: ${versionLabel(c.version_key!)}`,
    '',
    cut ? 'Bill text (cut: the bill is longer than this):' : 'Bill text:',
    '<bill_text>',
    text,
    '</bill_text>',
  ].join('\n')
}

function buildPrompt(c: SummaryCandidate): string {
  const lines = [
    `Bill: ${c.identifier}`,
    `Title: ${c.short_title}`,
    c.subject ? `Subject area: ${c.subject}` : null,
    c.sponsor_name ? `Sponsor: ${c.sponsor_name}${c.sponsor_party ? ` (${c.sponsor_party})` : ''}${c.sponsor_district ? `, ${c.sponsor_district}` : ''}` : 'Sponsor: not yet assigned',
    c.chamber ? `Chamber: ${c.chamber}` : null,
    c.status_name ? `Current status: ${c.status_name}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const sessionArg = args.find((a) => a.startsWith('--session='))
  const sessionOrdinals = sessionArg ? sessionArg.split('=')[1] : null
  const limitArg = args.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null

  const candidates = await getCandidates(force, sessionOrdinals, limit)
  const fromText = candidates.filter((c) => c.version_id).length
  console.log(
    `${candidates.length} bills need summaries${force ? ' (forced regeneration)' : ''}: ` +
      `${fromText} from bill text, ${candidates.length - fromText} from metadata`,
  )
  const byId = new Map(candidates.map((c) => [c.bill_id, c]))
  if (candidates.length === 0) {
    await pool.end()
    return
  }

  // The SDK only auto-attaches ANTHROPIC_WORKSPACE_ID for credential-file/OIDC
  // auth, not plain API-key auth — a workspace-scoped key needs it set here
  // explicitly or every request 400s with "anthropic-workspace-id is required".
  const client = new Anthropic({
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
      ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
      : undefined,
  })

  const batch = await client.messages.batches.create({
    requests: candidates.map((c) => ({
      custom_id: String(c.bill_id),
      params: {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: c.version_id ? TEXT_SYSTEM_PROMPT : SYSTEM_PROMPT,
        messages: [{ role: 'user', content: c.version_id ? buildTextPrompt(c) : buildPrompt(c) }],
      },
    })),
  })
  console.log(`submitted batch ${batch.id} (${candidates.length} requests)`)

  let current = batch
  while (current.processing_status !== 'ended') {
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    current = await client.messages.batches.retrieve(batch.id)
    console.log(
      `  status=${current.processing_status} succeeded=${current.request_counts.succeeded} ` +
        `errored=${current.request_counts.errored} processing=${current.request_counts.processing}`,
    )
  }

  let saved = 0
  let failed = 0
  for await (const result of await client.messages.batches.results(batch.id)) {
    const billId = Number(result.custom_id)
    if (result.result.type === 'succeeded') {
      const textBlock = result.result.message.content.find((b) => b.type === 'text')
      const summary = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : null
      if (!summary) {
        failed += 1
        continue
      }
      const c = byId.get(billId)
      await pool.query(
        `INSERT INTO bill_summaries (bill_id, summary, model, source, text_version_id, version_key, version_posted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (bill_id) DO UPDATE SET summary = $2, model = $3, generated_at = now(),
           source = $4, text_version_id = $5, version_key = $6, version_posted_at = $7`,
        [billId, summary, MODEL, c?.version_id ? 'text' : 'metadata', c?.version_id ?? null, c?.version_key ?? null, c?.version_posted_at ?? null],
      )
      saved += 1
    } else {
      console.error(`  bill ${billId} ${result.result.type}`)
      failed += 1
    }
  }

  console.log(`done. ${saved} summaries saved, ${failed} failed.`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
