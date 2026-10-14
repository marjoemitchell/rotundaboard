// Bill text comparison for the API: a redline between two versions of a
// bill, and the changes of one amendment (see src/billText.ts).
import { pool } from '../db.js'
import {
  diffParagraphs,
  versionLabel,
  type ChangedParagraph,
  type DiffPart,
  type Mark,
  type Paragraph,
} from '../billText.js'

/** Words with one mark. A paragraph break is "\n". */
export type ApiRun = [text: string, mark: Mark]
export interface ApiDiffPart {
  op: '=' | '-' | '+'
  runs: ApiRun[]
}

/** A compact form of diff parts: words with the same mark are one run. */
function compact(parts: DiffPart[]): ApiDiffPart[] {
  return parts.map((part) => {
    const runs: ApiRun[] = []
    for (const token of part.tokens) {
      const last = runs[runs.length - 1]
      if (token.text === '\n') runs.push(['\n', 0])
      else if (last && last[1] === token.mark && last[0] !== '\n') last[0] += ` ${token.text}`
      else runs.push([token.text, token.mark])
    }
    return { op: part.op, runs }
  })
}

export async function compareVersions(billId: number, fromKey: string, toKey: string) {
  const { rows } = await pool.query<{ version_key: string; posted_at: string | null; paragraphs: Paragraph[] }>(
    `SELECT version_key, posted_at, paragraphs FROM bill_text_versions WHERE bill_id = $1 AND version_key = ANY($2)`,
    [billId, [fromKey, toKey]],
  )
  const from = rows.find((r) => r.version_key === fromKey)
  const to = rows.find((r) => r.version_key === toKey)
  if (!from || !to) return null
  const info = (r: typeof from) => ({ key: r.version_key, label: versionLabel(r.version_key), postedAt: r.posted_at })
  return { from: info(from), to: info(to), parts: compact(diffParagraphs(from.paragraphs, to.paragraphs)) }
}

export async function getAmendmentChanges(billId: number, documentId: number) {
  const { rows } = await pool.query<{ changes: ChangedParagraph[] | null; summary: string | null; bill_version: number }>(
    `SELECT changes, summary, bill_version FROM amendment_documents WHERE bill_id = $1 AND id = $2`,
    [billId, documentId],
  )
  const row = rows[0]
  if (!row || !row.changes) return null
  return {
    summary: row.summary,
    baseVersion: { key: String(row.bill_version), label: versionLabel(String(row.bill_version)) },
    paragraphs: row.changes.map((c) => compact(c.parts)),
  }
}
