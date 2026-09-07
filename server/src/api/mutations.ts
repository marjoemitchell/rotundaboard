// Writes to the workspace layer only (users / tracked_bills / saved_views /
// activity_log / etc.) — never to scraped legislative data, which is
// read-only and only ever changes via re-running the scraper.
//
// Every function here takes a workspaceId and scopes its query by it. That's
// not optional decoration: without it, a valid session in workspace A could
// mutate or read a row belonging to workspace B just by guessing its numeric
// id, since ids themselves (bill_id, testimony id, etc.) carry no tenant
// information on their own.
import { pool } from '../db.js'
import { getBills, getFollowedCommittees, getSubjectWatches } from './queries.js'

export class MutationError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const VALID_POSITIONS = ['support', 'oppose', 'watch', 'neutral'] as const
type Position = (typeof VALID_POSITIONS)[number]

async function requireTrackedBill(workspaceId: number, billId: number) {
  const { rows } = await pool.query('SELECT bill_id FROM tracked_bills WHERE workspace_id = $1 AND bill_id = $2', [
    workspaceId,
    billId,
  ])
  if (rows.length === 0) throw new MutationError(404, `bill ${billId} is not tracked`)
}

export async function requireWorkspaceMember(workspaceId: number, userId: number) {
  const { rows } = await pool.query<{ id: number; name: string }>(
    `SELECT u.id, u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
    [workspaceId, userId],
  )
  if (rows.length === 0) throw new MutationError(404, `user ${userId} is not a member of this workspace`)
  return rows[0]
}

async function logActivity(workspaceId: number, actorId: number, verb: string, detail: string, billId: number) {
  await pool.query(
    'INSERT INTO activity_log (workspace_id, actor_id, verb, detail, bill_id) VALUES ($1, $2, $3, $4, $5)',
    [workspaceId, actorId, verb, detail, billId],
  )
}

export async function setBillPosition(workspaceId: number, billId: number, position: string | null) {
  if (position !== null && !VALID_POSITIONS.includes(position as Position)) {
    throw new MutationError(400, `position must be one of ${VALID_POSITIONS.join(', ')}, or null`)
  }
  await requireTrackedBill(workspaceId, billId)

  await pool.query('UPDATE tracked_bills SET position = $1 WHERE workspace_id = $2 AND bill_id = $3', [
    position,
    workspaceId,
    billId,
  ])
  return { billId, position }
}

export async function setBillAssignee(workspaceId: number, billId: number, assigneeId: number | null) {
  await requireTrackedBill(workspaceId, billId)
  if (assigneeId !== null) await requireWorkspaceMember(workspaceId, assigneeId)

  await pool.query('UPDATE tracked_bills SET assignee_id = $1 WHERE workspace_id = $2 AND bill_id = $3', [
    assigneeId,
    workspaceId,
    billId,
  ])
  return { billId, assigneeId }
}

export async function trackBill(workspaceId: number, billId: number, userId: number) {
  const { rows } = await pool.query('SELECT id FROM bills WHERE id = $1', [billId])
  if (rows.length === 0) throw new MutationError(404, `bill ${billId} not found`)

  const { rowCount } = await pool.query(
    'INSERT INTO tracked_bills (workspace_id, bill_id) VALUES ($1, $2) ON CONFLICT (workspace_id, bill_id) DO NOTHING',
    [workspaceId, billId],
  )
  if (rowCount && rowCount > 0) {
    await logActivity(workspaceId, userId, 'started tracking', 'Added to tracked bills', billId)
  }
  return { billId, tracked: true }
}

export async function untrackBill(workspaceId: number, billId: number, userId: number) {
  await requireTrackedBill(workspaceId, billId)

  await pool.query('DELETE FROM tracked_bills WHERE workspace_id = $1 AND bill_id = $2', [workspaceId, billId])
  await logActivity(workspaceId, userId, 'stopped tracking', 'Removed from tracked bills', billId)
  return { billId, tracked: false }
}

export async function createSavedView(workspaceId: number, name: string, color: string, query: string, userId: number) {
  if (!name?.trim()) throw new MutationError(400, 'name is required')
  if (!query?.trim()) throw new MutationError(400, 'query is required')

  const id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  await pool.query(
    'INSERT INTO saved_views (id, workspace_id, name, color, query, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, workspaceId, name.trim(), color || '#5c6b80', query.trim(), userId],
  )
  return { id, name: name.trim(), color: color || '#5c6b80', query: query.trim() }
}

export async function deleteSavedView(workspaceId: number, id: string, userId: number, role: 'admin' | 'member') {
  const { rows } = await pool.query<{ created_by: number | null }>(
    'SELECT created_by FROM saved_views WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  )
  if (rows.length === 0) throw new MutationError(404, `saved view ${id} not found`)
  if (role !== 'admin' && rows[0].created_by !== userId) {
    throw new MutationError(403, 'only the creator or an admin can delete this saved view')
  }
  await pool.query('DELETE FROM saved_views WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
}

export async function createNote(
  workspaceId: number,
  billId: number | null,
  authorId: number,
  body: string,
  sourceHearing: string | null,
) {
  if (!body?.trim()) throw new MutationError(400, 'body is required')
  if (billId !== null) {
    const { rows } = await pool.query('SELECT id FROM bills WHERE id = $1', [billId])
    if (rows.length === 0) throw new MutationError(404, `bill ${billId} not found`)
  }

  const { rows } = await pool.query<{ id: number; created_at: string }>(
    `INSERT INTO notes (workspace_id, bill_id, author_id, body, source_hearing) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [workspaceId, billId, authorId, body.trim(), sourceHearing],
  )
  if (billId !== null) {
    await logActivity(workspaceId, authorId, 'added a note', body.trim().slice(0, 120), billId)
  }
  return { id: String(rows[0].id), createdAt: rows[0].created_at }
}

export async function deleteNote(workspaceId: number, id: number) {
  const { rowCount } = await pool.query('DELETE FROM notes WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
  if (rowCount === 0) throw new MutationError(404, `note ${id} not found`)
}

export async function tagBill(workspaceId: number, billId: number, tagName: string, userId: number) {
  const name = tagName?.trim()
  if (!name) throw new MutationError(400, 'tag name is required')
  const { rows: billRows } = await pool.query('SELECT id FROM bills WHERE id = $1', [billId])
  if (billRows.length === 0) throw new MutationError(404, `bill ${billId} not found`)

  const { rows: tagRows } = await pool.query<{ id: number; name: string }>(
    `INSERT INTO tags (workspace_id, name, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name`,
    [workspaceId, name, userId],
  )
  const tag = tagRows[0]
  await pool.query('INSERT INTO bill_tags (bill_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [billId, tag.id])
  return { id: String(tag.id), name: tag.name }
}

export async function untagBill(workspaceId: number, billId: number, tagId: number) {
  const { rowCount } = await pool.query(
    `DELETE FROM bill_tags WHERE bill_id = $1 AND tag_id = $2
     AND tag_id IN (SELECT id FROM tags WHERE workspace_id = $3)`,
    [billId, tagId, workspaceId],
  )
  if (rowCount === 0) throw new MutationError(404, `bill ${billId} is not tagged with tag ${tagId}`)
}

export async function createSubjectWatch(
  workspaceId: number,
  name: string,
  subjectCodes: string[],
  tagIds: number[],
  userId: number,
) {
  if (!name?.trim()) throw new MutationError(400, 'name is required')
  if (subjectCodes.length === 0 && tagIds.length === 0) {
    throw new MutationError(400, 'a watch needs at least one subject or tag')
  }

  const { rows } = await pool.query<{ id: number; created_at: string }>(
    `INSERT INTO subject_watches (workspace_id, name, subject_codes, tag_ids, created_by) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [workspaceId, name.trim(), subjectCodes, tagIds, userId],
  )
  return { id: String(rows[0].id), createdAt: rows[0].created_at }
}

export async function deleteSubjectWatch(workspaceId: number, id: number, userId: number, role: 'admin' | 'member') {
  const { rows } = await pool.query<{ created_by: number | null }>(
    'SELECT created_by FROM subject_watches WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  )
  if (rows.length === 0) throw new MutationError(404, `subject watch ${id} not found`)
  if (role !== 'admin' && rows[0].created_by !== userId) {
    throw new MutationError(403, 'only the creator or an admin can delete this watch')
  }
  await pool.query('DELETE FROM subject_watches WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
}

export async function followCommittee(workspaceId: number, committeeId: number, userId: number) {
  const { rows } = await pool.query('SELECT id FROM non_standing_committees WHERE id = $1', [committeeId])
  if (rows.length === 0) throw new MutationError(404, `committee ${committeeId} not found`)

  await pool.query(
    `INSERT INTO followed_committees (workspace_id, committee_id, followed_by) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, committee_id) DO NOTHING`,
    [workspaceId, committeeId, userId],
  )
  return { committeeId, followed: true }
}

export async function unfollowCommittee(workspaceId: number, committeeId: number) {
  const { rowCount } = await pool.query('DELETE FROM followed_committees WHERE workspace_id = $1 AND committee_id = $2', [
    workspaceId,
    committeeId,
  ])
  if (rowCount === 0) throw new MutationError(404, `committee ${committeeId} is not followed`)
  return { committeeId, followed: false }
}

const VALID_TESTIMONY_STATUSES = ['draft', 'submitted', 'delivered'] as const

export async function createTestimony(
  workspaceId: number,
  params: {
    billId: number
    committeeMeetingId: number | null
    authorId: number
    position: string | null
    body: string
  },
) {
  const { billId, committeeMeetingId, authorId, position, body } = params
  if (position !== null && !VALID_POSITIONS.includes(position as Position)) {
    throw new MutationError(400, `position must be one of ${VALID_POSITIONS.join(', ')}, or null`)
  }
  const { rows } = await pool.query('SELECT id FROM bills WHERE id = $1', [billId])
  if (rows.length === 0) throw new MutationError(404, `bill ${billId} not found`)

  const { rows: inserted } = await pool.query<{ id: number; created_at: string }>(
    `INSERT INTO testimony (workspace_id, bill_id, committee_meeting_id, author_id, position, body)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [workspaceId, billId, committeeMeetingId, authorId, position, body?.trim() ?? ''],
  )
  await logActivity(workspaceId, authorId, 'drafted testimony', (body ?? '').trim().slice(0, 120) || 'New testimony draft', billId)
  return { id: String(inserted[0].id), createdAt: inserted[0].created_at }
}

async function requireTestimony(workspaceId: number, id: number) {
  const { rows } = await pool.query<{ bill_id: number }>(
    'SELECT bill_id FROM testimony WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  )
  if (rows.length === 0) throw new MutationError(404, `testimony ${id} not found`)
  return rows[0]
}

export async function updateTestimony(
  workspaceId: number,
  id: number,
  updates: { body?: string; position?: string | null; status?: string; committeeMeetingId?: number | null },
  actorId: number,
) {
  const existing = await requireTestimony(workspaceId, id)
  if (updates.position !== undefined && updates.position !== null && !VALID_POSITIONS.includes(updates.position as Position)) {
    throw new MutationError(400, `position must be one of ${VALID_POSITIONS.join(', ')}, or null`)
  }
  if (updates.status !== undefined && !VALID_TESTIMONY_STATUSES.includes(updates.status as (typeof VALID_TESTIMONY_STATUSES)[number])) {
    throw new MutationError(400, `status must be one of ${VALID_TESTIMONY_STATUSES.join(', ')}`)
  }

  const sets: string[] = []
  const values: unknown[] = []
  let i = 1
  if (updates.body !== undefined) {
    sets.push(`body = $${i++}`)
    values.push(updates.body.trim())
  }
  if (updates.position !== undefined) {
    sets.push(`position = $${i++}`)
    values.push(updates.position)
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${i++}`)
    values.push(updates.status)
  }
  if (updates.committeeMeetingId !== undefined) {
    sets.push(`committee_meeting_id = $${i++}`)
    values.push(updates.committeeMeetingId)
  }
  if (sets.length === 0) return { id, updated: false }

  sets.push('updated_at = now()')
  values.push(workspaceId, id)
  await pool.query(`UPDATE testimony SET ${sets.join(', ')} WHERE workspace_id = $${i++} AND id = $${i}`, values)

  if (updates.status !== undefined) {
    await logActivity(workspaceId, actorId, 'updated testimony status', `Marked testimony as ${updates.status}`, existing.bill_id)
  }
  return { id, updated: true }
}

export async function deleteTestimony(workspaceId: number, id: number) {
  const { rowCount } = await pool.query('DELETE FROM testimony WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
  if (rowCount === 0) throw new MutationError(404, `testimony ${id} not found`)
}

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

export async function setTestimonyAttachment(workspaceId: number, id: number, filename: string, mimeType: string, dataBase64: string) {
  await requireTestimony(workspaceId, id)
  if (!filename?.trim()) throw new MutationError(400, 'filename is required')
  const buffer = Buffer.from(dataBase64, 'base64')
  if (buffer.length === 0) throw new MutationError(400, 'file is empty')
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new MutationError(413, 'file is too large (max 15MB)')

  await pool.query(
    `UPDATE testimony SET attachment_filename = $1, attachment_mime_type = $2, attachment_data = $3, updated_at = now()
     WHERE workspace_id = $4 AND id = $5`,
    [filename.trim(), mimeType || 'application/octet-stream', buffer, workspaceId, id],
  )
  return { id, filename: filename.trim() }
}

export async function clearTestimonyAttachment(workspaceId: number, id: number) {
  await requireTestimony(workspaceId, id)
  await pool.query(
    `UPDATE testimony SET attachment_filename = NULL, attachment_mime_type = NULL, attachment_data = NULL, updated_at = now()
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  )
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// A digest is a snapshot, not a live view — everything here is computed once
// at generation time from real data (same rule-based approach as the
// dashboard's Morning Brief, getBrief() in queries.ts — no AI call, no new
// cost) and then frozen into the row, so a digest from three weeks ago still
// reads the way it did the day it was generated.
export async function generateDigest(workspaceId: number, userId: number) {
  const { rows: lastDigestRows } = await pool.query<{ period_end: string }>(
    'SELECT period_end FROM digests WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1',
    [workspaceId],
  )
  const periodEnd = new Date()
  const periodStart = lastDigestRows[0]
    ? new Date(lastDigestRows[0].period_end)
    : new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [bills, followedCommittees, subjectWatches, activityRows, testimonyCountRows] = await Promise.all([
    getBills(workspaceId),
    getFollowedCommittees(workspaceId),
    getSubjectWatches(workspaceId),
    pool.query<{ actor_name: string | null; verb: string; detail: string; occurred_at: string }>(
      `SELECT u.name AS actor_name, al.verb, al.detail, al.occurred_at
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.workspace_id = $1 AND al.occurred_at > $2 AND al.occurred_at <= $3
       ORDER BY al.occurred_at DESC`,
      [workspaceId, periodStart.toISOString(), periodEnd.toISOString()],
    ),
    pool.query<{ status: string; n: string }>('SELECT status, count(*) AS n FROM testimony WHERE workspace_id = $1 GROUP BY status', [
      workspaceId,
    ]),
  ])

  // Momentum highlights — same logic the Morning Brief uses for topMover/biggestDrop.
  const sorted = [...bills].sort((a, b) => b.momentum.delta7d - a.momentum.delta7d)
  const topMover = sorted[0]
  const biggestDrop = sorted[sorted.length - 1]
  const highlights: { billId: string; identifier: string; title: string; detail: string }[] = []
  if (topMover && topMover.momentum.delta7d > 0) {
    highlights.push({
      billId: topMover.id,
      identifier: topMover.identifier,
      title: topMover.title,
      detail: `Strongest 7-day momentum gain (+${topMover.momentum.delta7d}).`,
    })
  }
  if (biggestDrop && biggestDrop.momentum.delta7d < 0 && biggestDrop.id !== topMover?.id) {
    highlights.push({
      billId: biggestDrop.id,
      identifier: biggestDrop.identifier,
      title: biggestDrop.title,
      detail: `Lost the most ground (${biggestDrop.momentum.delta7d}).`,
    })
  }

  const activityItems = activityRows.rows.slice(0, 8).map((r) => `${r.actor_name ?? 'Someone'} ${r.detail}`)

  // Upcoming hearings among followed interim committees — the only
  // genuinely forward-looking hearing data once a session's concluded.
  const upcomingItems = followedCommittees
    .filter((c) => c.nextMeetingAt)
    .map((c) => `${c.name} meets ${formatWhen(c.nextMeetingAt as string)}${c.nextLocation ? ` · ${c.nextLocation}` : ''}`)

  const testimonyCounts: Record<string, number> = { draft: 0, submitted: 0, delivered: 0 }
  for (const row of testimonyCountRows.rows) testimonyCounts[row.status] = Number(row.n)
  const testimonyItems = [`${testimonyCounts.draft} in draft, ${testimonyCounts.submitted} submitted, ${testimonyCounts.delivered} delivered.`]

  const watchItems = subjectWatches
    .filter((w) => w.untrackedCount > 0)
    .map((w) => `"${w.name}" has ${w.untrackedCount} untracked bill${w.untrackedCount === 1 ? '' : 's'} matching.`)

  const sections = [
    { title: 'Team activity', items: activityItems.length > 0 ? activityItems : ['No team activity in this period.'] },
    {
      title: 'Upcoming hearings',
      items: upcomingItems.length > 0 ? upcomingItems : ['No upcoming hearings among followed committees.'],
    },
    { title: 'Testimony status', items: testimonyItems },
    { title: 'Subject watches', items: watchItems.length > 0 ? watchItems : ['No new matches on active subject watches.'] },
  ]

  const summaryParts: string[] = [
    `${activityRows.rows.length} team action${activityRows.rows.length === 1 ? '' : 's'} logged since ${formatWhen(periodStart.toISOString())}.`,
  ]
  if (highlights.length > 0) summaryParts.push(highlights.map((h) => `${h.identifier} — ${h.detail}`).join(' '))
  if (upcomingItems.length > 0) {
    summaryParts.push(
      `${upcomingItems.length} followed committee${upcomingItems.length === 1 ? '' : 's'} with a hearing coming up.`,
    )
  }

  const { rows: inserted } = await pool.query<{ id: number; created_at: string }>(
    `INSERT INTO digests (workspace_id, period_start, period_end, summary, highlights, sections, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [
      workspaceId,
      periodStart.toISOString(),
      periodEnd.toISOString(),
      summaryParts.join(' '),
      JSON.stringify(highlights),
      JSON.stringify(sections),
      userId,
    ],
  )

  return { id: String(inserted[0].id), createdAt: inserted[0].created_at }
}

export async function deleteDigest(workspaceId: number, id: number) {
  const { rowCount } = await pool.query('DELETE FROM digests WHERE workspace_id = $1 AND id = $2', [workspaceId, id])
  if (rowCount === 0) throw new MutationError(404, `digest ${id} not found`)
}
