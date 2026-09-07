import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import * as queries from './queries.js'
import * as mutations from './mutations.js'
import { MutationError } from './mutations.js'
import { authRouter } from './auth.js'
import { requireAuth, requireAdmin, SESSION_COOKIE_NAME } from './authMiddleware.js'
import * as invites from './invites.js'
import * as workspaces from './workspaces.js'
import { pool } from '../db.js'
import { hashToken } from '../auth/tokens.js'
import { getLastEmailTo } from '../auth/email.js'

const app = express()
// Railway (and most PaaS runtimes) assign the listen port via $PORT at
// deploy time; API_PORT stays as the local-dev override.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000)

// credentials: true (a session cookie) requires a concrete origin, not the
// cors package's wildcard default — APP_BASE_URL does double duty as that
// origin and as the base for invite/reset links (see auth.ts).
app.use(cors({ origin: process.env.APP_BASE_URL ?? 'http://localhost:5173', credentials: true }))
app.use(cookieParser())
// 20mb: testimony attachments arrive base64-encoded in the JSON body (no
// multipart handling elsewhere in this API), which inflates size by ~33% —
// comfortably covers the 15MB attachment cap enforced in mutations.ts.
app.use(express.json({ limit: '20mb' }))

function handleError(res: Response, path: string, err: unknown) {
  if (err instanceof MutationError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(`${path} failed:`, err)
  res.status(500).json({ error: 'internal error' })
}

app.use('/api/auth', authRouter)
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// Public: the accept-invite landing page needs to know what it's showing
// (workspace name, whether to render a login or signup form) before the
// visitor has any session at all.
app.get('/api/invites/:token', async (req, res) => {
  try {
    const invite = await invites.getInviteByToken(req.params.token)
    if (!invite) {
      res.status(404).json({ error: 'this invite is invalid or has expired' })
      return
    }
    res.json(invite)
  } catch (err) {
    handleError(res, 'GET /api/invites/:token', err)
  }
})

// Dev/test only: lets the e2e suite read back an invite/reset-password
// email's content without a real inbox, regardless of whether Resend is
// configured (sendEmail() always captures a copy — see auth/email.ts).
// Never mounted in production.
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/__test__/last-email', (req, res) => {
    const to = typeof req.query.to === 'string' ? req.query.to : ''
    const email = to ? getLastEmailTo(to) : undefined
    if (!email) {
      res.status(404).json({ error: 'no email captured for that address' })
      return
    }
    res.json(email)
  })
}

// Everything below requires a valid session — req.auth.{userId,workspaceId,role}
// is read off the session row server-side (see authMiddleware.ts), never
// trusted from anything the client sends per-request.
app.use('/api', requireAuth)

// Accepting with an existing (already logged-in) account. A fresh signup
// goes through POST /api/auth/signup with inviteToken set instead, since
// that path also has to create the user.
app.post('/api/invites/:token/accept', async (req, res) => {
  try {
    const result = await invites.acceptInviteForExistingUser(req.params.token, req.auth!.userId)
    // Switch the session straight into the workspace they just joined.
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
    if (rawToken) {
      await pool.query('UPDATE user_sessions SET current_workspace_id = $1 WHERE id = $2', [
        result.workspaceId,
        hashToken(rawToken),
      ])
    }
    res.status(200).json({ ok: true })
  } catch (err) {
    handleError(res, 'POST /api/invites/:token/accept', err)
  }
})

function checkOwnWorkspace(req: Request): number {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id !== req.auth!.workspaceId) {
    throw new MutationError(403, 'not authorized for this workspace')
  }
  return id
}

app.get('/api/workspaces/:id/invites', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    res.json(await invites.getWorkspaceInvites(workspaceId))
  } catch (err) {
    handleError(res, `GET /api/workspaces/${req.params.id}/invites`, err)
  }
})

app.post('/api/workspaces/:id/invites', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    const { email, role } = req.body as { email: string; role: string }
    res.status(201).json(await invites.createInvite(workspaceId, req.auth!.userId, email, role))
  } catch (err) {
    handleError(res, `POST /api/workspaces/${req.params.id}/invites`, err)
  }
})

app.delete('/api/workspaces/:id/invites/:inviteId', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    const inviteId = Number(req.params.inviteId)
    if (!Number.isInteger(inviteId)) {
      res.status(400).json({ error: 'invalid invite id' })
      return
    }
    await invites.revokeInvite(workspaceId, inviteId)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/workspaces/${req.params.id}/invites/${req.params.inviteId}`, err)
  }
})

app.post('/api/workspaces/:id/invites/:inviteId/resend', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    const inviteId = Number(req.params.inviteId)
    if (!Number.isInteger(inviteId)) {
      res.status(400).json({ error: 'invalid invite id' })
      return
    }
    await invites.resendInvite(workspaceId, inviteId)
    res.status(204).end()
  } catch (err) {
    handleError(res, `POST /api/workspaces/${req.params.id}/invites/${req.params.inviteId}/resend`, err)
  }
})

app.get('/api/workspaces/:id/members', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    res.json(await workspaces.getDetailedMembers(workspaceId))
  } catch (err) {
    handleError(res, `GET /api/workspaces/${req.params.id}/members`, err)
  }
})

app.patch('/api/workspaces/:id', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    const { name } = req.body as { name: string }
    res.json(await workspaces.renameWorkspace(workspaceId, name))
  } catch (err) {
    handleError(res, `PATCH /api/workspaces/${req.params.id}`, err)
  }
})

app.delete('/api/workspaces/:id', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    res.json(await workspaces.deleteWorkspace(workspaceId, req.auth!.userId))
  } catch (err) {
    handleError(res, `DELETE /api/workspaces/${req.params.id}`, err)
  }
})

app.patch('/api/workspaces/:id/members/:userId', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    const targetUserId = Number(req.params.userId)
    if (!Number.isInteger(targetUserId)) {
      res.status(400).json({ error: 'invalid user id' })
      return
    }
    const { role } = req.body as { role: string }
    res.json(await workspaces.updateMemberRole(workspaceId, targetUserId, role))
  } catch (err) {
    handleError(res, `PATCH /api/workspaces/${req.params.id}/members/${req.params.userId}`, err)
  }
})

app.delete('/api/workspaces/:id/members/:userId', async (req, res) => {
  try {
    const workspaceId = checkOwnWorkspace(req)
    requireAdmin(req)
    const targetUserId = Number(req.params.userId)
    if (!Number.isInteger(targetUserId)) {
      res.status(400).json({ error: 'invalid user id' })
      return
    }
    await workspaces.removeMember(workspaceId, targetUserId, req.auth!.userId)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/workspaces/${req.params.id}/members/${req.params.userId}`, err)
  }
})

function route(path: string, handler: (req: Request) => Promise<unknown>) {
  app.get(path, async (req, res) => {
    try {
      res.json(await handler(req))
    } catch (err) {
      handleError(res, `GET ${path}`, err)
    }
  })
}

route('/api/session-calendar', () => queries.getSessionCalendar())
route('/api/bills', (req) => queries.getBills(req.auth!.workspaceId))
route('/api/brief', (req) => queries.getBrief(req.auth!.workspaceId))
route('/api/hearings', () => queries.getHearings())
route('/api/hearings/schedule', (req) => queries.getUpcomingHearings(req.auth!.workspaceId))
route('/api/team-board', (req) => queries.getTeamBoard(req.auth!.workspaceId))
route('/api/workspace-members', (req) => queries.getWorkspaceMembers(req.auth!.workspaceId))
route('/api/momentum-factors', () => queries.getMomentumFactors())
route('/api/saved-views', (req) => queries.getSavedViews(req.auth!.workspaceId))
route('/api/nav-counts', (req) => queries.getNavCounts(req.auth!.workspaceId))
route('/api/sessions', (req) => queries.getSessions(req.auth!.workspaceId))
route('/api/legislators', () => queries.getLegislators())
route('/api/notes', (req) => queries.getNotes(req.auth!.workspaceId))
route('/api/subject-codes', () => queries.getSubjectCodes())
route('/api/tags', (req) => queries.getTags(req.auth!.workspaceId))
route('/api/subject-watches', (req) => queries.getSubjectWatches(req.auth!.workspaceId))
route('/api/committees', (req) => queries.getNonStandingCommittees(req.auth!.workspaceId))
route('/api/followed-committees', (req) => queries.getFollowedCommittees(req.auth!.workspaceId))
route('/api/testimony', (req) => queries.getTestimony(req.auth!.workspaceId))
route('/api/digests', (req) => queries.getDigests(req.auth!.workspaceId))

app.get('/api/legislators/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid legislator id' })
    return
  }
  try {
    const detail = await queries.getLegislatorDetail(id)
    if (!detail) {
      res.status(404).json({ error: `legislator ${id} not found` })
      return
    }
    res.json(detail)
  } catch (err) {
    handleError(res, `GET /api/legislators/${req.params.id}`, err)
  }
})

function parseBillId(req: Request, res: Response): number | null {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid bill id' })
    return null
  }
  return id
}

app.get('/api/bills/:id', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    const detail = await queries.getBillDetail(billId, req.auth!.workspaceId)
    if (!detail) {
      res.status(404).json({ error: `bill ${billId} not found` })
      return
    }
    res.json(detail)
  } catch (err) {
    handleError(res, `GET /api/bills/${req.params.id}`, err)
  }
})

app.get('/api/bills/:id/notes', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    res.json(await queries.getBillNotes(billId, req.auth!.workspaceId))
  } catch (err) {
    handleError(res, `GET /api/bills/${req.params.id}/notes`, err)
  }
})

app.post('/api/notes', async (req, res) => {
  try {
    const { billId, body, sourceHearing } = req.body as {
      billId?: string | null
      body: string
      sourceHearing?: string | null
    }
    const parsedBillId = billId ? Number(billId) : null
    if (billId && !Number.isInteger(parsedBillId)) {
      res.status(400).json({ error: 'invalid bill id' })
      return
    }
    res.status(201).json(
      await mutations.createNote(req.auth!.workspaceId, parsedBillId, req.auth!.userId, body, sourceHearing ?? null),
    )
  } catch (err) {
    handleError(res, 'POST /api/notes', err)
  }
})

app.delete('/api/notes/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid note id' })
    return
  }
  try {
    await mutations.deleteNote(req.auth!.workspaceId, id)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/notes/${req.params.id}`, err)
  }
})

app.get('/api/bills/:id/tags', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    res.json(await queries.getBillTags(billId, req.auth!.workspaceId))
  } catch (err) {
    handleError(res, `GET /api/bills/${req.params.id}/tags`, err)
  }
})

app.post('/api/bills/:id/tags', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    const { name } = req.body as { name: string }
    res.status(201).json(await mutations.tagBill(req.auth!.workspaceId, billId, name, req.auth!.userId))
  } catch (err) {
    handleError(res, `POST /api/bills/${req.params.id}/tags`, err)
  }
})

app.delete('/api/bills/:id/tags/:tagId', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  const tagId = Number(req.params.tagId)
  if (!Number.isInteger(tagId)) {
    res.status(400).json({ error: 'invalid tag id' })
    return
  }
  try {
    await mutations.untagBill(req.auth!.workspaceId, billId, tagId)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/bills/${req.params.id}/tags/${req.params.tagId}`, err)
  }
})

app.get('/api/subject-watches/:id/bills', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid subject watch id' })
    return
  }
  try {
    const bills = await queries.getSubjectWatchBills(id, req.auth!.workspaceId)
    if (!bills) {
      res.status(404).json({ error: `subject watch ${id} not found` })
      return
    }
    res.json(bills)
  } catch (err) {
    handleError(res, `GET /api/subject-watches/${req.params.id}/bills`, err)
  }
})

app.post('/api/subject-watches', async (req, res) => {
  try {
    const { name, subjectCodes, tagIds } = req.body as {
      name: string
      subjectCodes?: string[]
      tagIds?: string[]
    }
    const parsedTagIds = (tagIds ?? []).map(Number)
    if (parsedTagIds.some((n) => !Number.isInteger(n))) {
      res.status(400).json({ error: 'invalid tag id' })
      return
    }
    res.status(201).json(
      await mutations.createSubjectWatch(req.auth!.workspaceId, name, subjectCodes ?? [], parsedTagIds, req.auth!.userId),
    )
  } catch (err) {
    handleError(res, 'POST /api/subject-watches', err)
  }
})

app.delete('/api/subject-watches/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid subject watch id' })
    return
  }
  try {
    await mutations.deleteSubjectWatch(req.auth!.workspaceId, id, req.auth!.userId, req.auth!.role)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/subject-watches/${req.params.id}`, err)
  }
})

app.get('/api/committees/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid committee id' })
    return
  }
  try {
    const detail = await queries.getNonStandingCommitteeDetail(id, req.auth!.workspaceId)
    if (!detail) {
      res.status(404).json({ error: `committee ${id} not found` })
      return
    }
    res.json(detail)
  } catch (err) {
    handleError(res, `GET /api/committees/${req.params.id}`, err)
  }
})

app.post('/api/committees/:id/follow', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid committee id' })
    return
  }
  try {
    res.status(201).json(await mutations.followCommittee(req.auth!.workspaceId, id, req.auth!.userId))
  } catch (err) {
    handleError(res, `POST /api/committees/${req.params.id}/follow`, err)
  }
})

app.delete('/api/committees/:id/follow', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid committee id' })
    return
  }
  try {
    await mutations.unfollowCommittee(req.auth!.workspaceId, id)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/committees/${req.params.id}/follow`, err)
  }
})

app.get('/api/bills/:id/testimony', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    res.json(await queries.getBillTestimony(billId, req.auth!.workspaceId))
  } catch (err) {
    handleError(res, `GET /api/bills/${req.params.id}/testimony`, err)
  }
})

app.post('/api/testimony', async (req, res) => {
  try {
    const { billId, committeeMeetingId, position, body } = req.body as {
      billId: string
      committeeMeetingId?: string | null
      position?: string | null
      body: string
    }
    const parsedBillId = Number(billId)
    if (!Number.isInteger(parsedBillId)) {
      res.status(400).json({ error: 'invalid bill id' })
      return
    }
    const parsedMeetingId = committeeMeetingId ? Number(committeeMeetingId) : null
    if (committeeMeetingId && !Number.isInteger(parsedMeetingId)) {
      res.status(400).json({ error: 'invalid committee meeting id' })
      return
    }
    res.status(201).json(
      await mutations.createTestimony(req.auth!.workspaceId, {
        billId: parsedBillId,
        committeeMeetingId: parsedMeetingId,
        authorId: req.auth!.userId,
        position: position ?? null,
        body,
      }),
    )
  } catch (err) {
    handleError(res, 'POST /api/testimony', err)
  }
})

app.patch('/api/testimony/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid testimony id' })
    return
  }
  try {
    const { body, position, status, committeeMeetingId } = req.body as {
      body?: string
      position?: string | null
      status?: string
      committeeMeetingId?: string | null
    }
    const updates: { body?: string; position?: string | null; status?: string; committeeMeetingId?: number | null } = {}
    if (body !== undefined) updates.body = body
    if (position !== undefined) updates.position = position
    if (status !== undefined) updates.status = status
    if (committeeMeetingId !== undefined) updates.committeeMeetingId = committeeMeetingId ? Number(committeeMeetingId) : null
    res.json(await mutations.updateTestimony(req.auth!.workspaceId, id, updates, req.auth!.userId))
  } catch (err) {
    handleError(res, `PATCH /api/testimony/${req.params.id}`, err)
  }
})

app.delete('/api/testimony/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid testimony id' })
    return
  }
  try {
    await mutations.deleteTestimony(req.auth!.workspaceId, id)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/testimony/${req.params.id}`, err)
  }
})

app.get('/api/testimony/:id/attachment', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid testimony id' })
    return
  }
  try {
    const attachment = await queries.getTestimonyAttachment(id, req.auth!.workspaceId)
    if (!attachment) {
      res.status(404).json({ error: 'no attachment' })
      return
    }
    // Strip quotes/control chars from the filename before it goes into a
    // header — it's user-supplied (whatever they named the file locally).
    const safeName = attachment.filename.replace(/["\r\n]/g, '')
    res.setHeader('Content-Type', attachment.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
    res.send(attachment.data)
  } catch (err) {
    handleError(res, `GET /api/testimony/${req.params.id}/attachment`, err)
  }
})

app.post('/api/testimony/:id/attachment', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid testimony id' })
    return
  }
  try {
    const { filename, mimeType, dataBase64 } = req.body as { filename: string; mimeType?: string; dataBase64: string }
    res.json(await mutations.setTestimonyAttachment(req.auth!.workspaceId, id, filename, mimeType ?? '', dataBase64))
  } catch (err) {
    handleError(res, `POST /api/testimony/${req.params.id}/attachment`, err)
  }
})

app.delete('/api/testimony/:id/attachment', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid testimony id' })
    return
  }
  try {
    await mutations.clearTestimonyAttachment(req.auth!.workspaceId, id)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/testimony/${req.params.id}/attachment`, err)
  }
})

app.get('/api/digests/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid digest id' })
    return
  }
  try {
    const digest = await queries.getDigest(id, req.auth!.workspaceId)
    if (!digest) {
      res.status(404).json({ error: `digest ${id} not found` })
      return
    }
    res.json(digest)
  } catch (err) {
    handleError(res, `GET /api/digests/${req.params.id}`, err)
  }
})

app.post('/api/digests', async (req, res) => {
  try {
    res.status(201).json(await mutations.generateDigest(req.auth!.workspaceId, req.auth!.userId))
  } catch (err) {
    handleError(res, 'POST /api/digests', err)
  }
})

app.delete('/api/digests/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid digest id' })
    return
  }
  try {
    await mutations.deleteDigest(req.auth!.workspaceId, id)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/digests/${req.params.id}`, err)
  }
})

app.get('/api/sessions/:id/bills', async (req, res) => {
  const sessionId = Number(req.params.id)
  if (!Number.isInteger(sessionId)) {
    res.status(400).json({ error: 'invalid session id' })
    return
  }
  try {
    res.json(await queries.getSessionBills(sessionId, req.auth!.workspaceId))
  } catch (err) {
    handleError(res, `GET /api/sessions/${req.params.id}/bills`, err)
  }
})

app.post('/api/bills/:id/track', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    res.status(201).json(await mutations.trackBill(req.auth!.workspaceId, billId, req.auth!.userId))
  } catch (err) {
    handleError(res, `POST /api/bills/${req.params.id}/track`, err)
  }
})

app.delete('/api/bills/:id/track', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    res.json(await mutations.untrackBill(req.auth!.workspaceId, billId, req.auth!.userId))
  } catch (err) {
    handleError(res, `DELETE /api/bills/${req.params.id}/track`, err)
  }
})

app.patch('/api/bills/:id/position', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    const { position } = req.body as { position: string | null }
    res.json(await mutations.setBillPosition(req.auth!.workspaceId, billId, position ?? null))
  } catch (err) {
    handleError(res, `PATCH /api/bills/${req.params.id}/position`, err)
  }
})

app.patch('/api/bills/:id/assignee', async (req, res) => {
  const billId = parseBillId(req, res)
  if (billId === null) return
  try {
    const { assigneeId } = req.body as { assigneeId: string | null }
    const parsedAssigneeId = assigneeId ? Number(assigneeId) : null
    if (assigneeId && !Number.isInteger(parsedAssigneeId)) {
      res.status(400).json({ error: 'invalid assignee id' })
      return
    }
    res.json(await mutations.setBillAssignee(req.auth!.workspaceId, billId, parsedAssigneeId))
  } catch (err) {
    handleError(res, `PATCH /api/bills/${req.params.id}/assignee`, err)
  }
})

app.post('/api/saved-views', async (req, res) => {
  try {
    const { name, color, query } = req.body as { name: string; color?: string; query: string }
    res.status(201).json(await mutations.createSavedView(req.auth!.workspaceId, name, color ?? '', query, req.auth!.userId))
  } catch (err) {
    handleError(res, 'POST /api/saved-views', err)
  }
})

app.delete('/api/saved-views/:id', async (req, res) => {
  try {
    await mutations.deleteSavedView(req.auth!.workspaceId, req.params.id, req.auth!.userId, req.auth!.role)
    res.status(204).end()
  } catch (err) {
    handleError(res, `DELETE /api/saved-views/${req.params.id}`, err)
  }
})

// Body-parser errors (e.g. a payload over the express.json limit) throw
// before any route handler runs, so the per-route try/catch blocks above
// never see them — this is the only place that can turn one into clean JSON
// instead of Express's default HTML error page.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.' })
    return
  }
  next(err)
})

app.listen(PORT, () => {
  console.log(`rotunda-board API listening on http://localhost:${PORT}`)
})
