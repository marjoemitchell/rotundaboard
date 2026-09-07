// One-time (re-runnable) batch job: generates a short plain-language summary
// for every bill that doesn't have one yet, using the Claude Batch API.
//
// Important limitation: we do NOT have actual bill text (see the shelved
// fiscal-notes/bill-text document-API work) — only metadata (title, subject,
// sponsor, status, outcome). The prompt is written to keep the model from
// over-claiming specifics the metadata doesn't support, but the app must
// still show every summary next to a "verify against the official record"
// disclaimer. Never treat this output as authoritative.
//
// Usage:
//   npm run generate-summaries              # only bills missing a summary
//   npm run generate-summaries -- --force    # regenerate every bill
//   npm run generate-summaries -- --session=20251   # limit to one session
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { pool } from './db.js'

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 300

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
      latest_status.occurred_at AS status_occurred_at
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
    ${force ? '' : 'LEFT JOIN bill_summaries bsum ON bsum.bill_id = b.id'}
    WHERE 1=1
      ${force ? '' : 'AND bsum.bill_id IS NULL'}
      ${sessionParamIndex ? `AND s.ordinals = $${sessionParamIndex}` : ''}
    ORDER BY b.id
    ${limitParamIndex ? `LIMIT $${limitParamIndex}` : ''}
    `,
    params,
  )
  return rows
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
  console.log(`${candidates.length} bills need summaries${force ? ' (forced regeneration)' : ''}`)
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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildPrompt(c) }],
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
      await pool.query(
        `INSERT INTO bill_summaries (bill_id, summary, model) VALUES ($1, $2, $3)
         ON CONFLICT (bill_id) DO UPDATE SET summary = $2, model = $3, generated_at = now()`,
        [billId, summary, MODEL],
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
