// Real data layer, backed by the rotunda-board-server API (see /server) over
// real 2025 Montana legislative session data in Postgres. Swap API_BASE for
// a production URL when deploying; every function here still just returns a
// Promise, so nothing above this layer (the hook, the components) needs to
// change based on where the data actually comes from.
//
// Every request sends the session cookie (credentials: 'include') — identity
// and workspace are derived server-side from it, so mutation functions no
// longer take an actorId/authorId parameter the way they used to under the
// old "acting as" picker.
import type {
  Activity,
  AuthSession,
  Bill,
  BillDetail,
  Brief,
  FollowedCommittee,
  Hearing,
  InviteLookup,
  LegislativeSession,
  LegislatorDetail,
  LegislatorSummary,
  MomentumFactor,
  NavCounts,
  NonStandingCommittee,
  NonStandingCommitteeDetail,
  Note,
  Position,
  SavedView,
  SessionBillSummary,
  SubjectWatchBillMatch,
  SessionCalendar,
  SubjectCode,
  SubjectWatch,
  Tag,
  TeamBoardSummary,
  TeamMember,
  Testimony,
  UpcomingHearing,
  WorkspaceInvite,
  WorkspaceMemberDetail,
} from '../types'

// Deployed builds proxy /api same-origin (see vite.config.ts's preview.proxy
// — needed so the session cookie survives, since browsers that block
// third-party cookies drop it otherwise), so the right default in a
// production build is a relative empty base, not a hardcoded host. Some
// hosts (Railway included) drop an explicitly empty-string variable value
// before it reaches the build, so this can't rely on VITE_API_BASE_URL
// being set to "" — it relies on it being absent instead, using Vite's own
// DEV/PROD flags to pick the right default for each build type.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '')

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

async function sendJson<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(`${method} ${path} -> ${res.status}: ${payload.error ?? 'unknown error'}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// --- Auth ------------------------------------------------------------------

export function getMe(): Promise<AuthSession> {
  return getJson('/api/auth/me')
}

export function login(email: string, password: string): Promise<{ id: number }> {
  return sendJson('/api/auth/login', 'POST', { email, password })
}

export function signup(params: {
  email: string
  password: string
  name: string
  workspaceName?: string
  inviteToken?: string
}): Promise<{ id: number }> {
  return sendJson('/api/auth/signup', 'POST', params)
}

export function logout(): Promise<void> {
  return sendJson('/api/auth/logout', 'POST')
}

export function forgotPassword(email: string): Promise<void> {
  return sendJson('/api/auth/forgot-password', 'POST', { email })
}

export function resetPassword(token: string, newPassword: string): Promise<void> {
  return sendJson('/api/auth/reset-password', 'POST', { token, newPassword })
}

export function switchWorkspace(workspaceId: number): Promise<void> {
  return sendJson('/api/auth/switch-workspace', 'POST', { workspaceId })
}

export function getInvite(token: string): Promise<InviteLookup> {
  return getJson(`/api/invites/${token}`)
}

export function acceptInvite(token: string): Promise<void> {
  return sendJson(`/api/invites/${token}/accept`, 'POST')
}

export function getWorkspaceInvites(workspaceId: number): Promise<WorkspaceInvite[]> {
  return getJson(`/api/workspaces/${workspaceId}/invites`)
}

export function createInvite(workspaceId: number, email: string, role: string): Promise<{ id: string }> {
  return sendJson(`/api/workspaces/${workspaceId}/invites`, 'POST', { email, role })
}

export function revokeInvite(workspaceId: number, inviteId: string): Promise<void> {
  return sendJson(`/api/workspaces/${workspaceId}/invites/${inviteId}`, 'DELETE')
}

export function resendInvite(workspaceId: number, inviteId: string): Promise<void> {
  return sendJson(`/api/workspaces/${workspaceId}/invites/${inviteId}/resend`, 'POST')
}

export function getDetailedWorkspaceMembers(workspaceId: number): Promise<WorkspaceMemberDetail[]> {
  return getJson(`/api/workspaces/${workspaceId}/members`)
}

export function renameWorkspace(workspaceId: number, name: string): Promise<{ name: string }> {
  return sendJson(`/api/workspaces/${workspaceId}`, 'PATCH', { name })
}

export function deleteWorkspace(workspaceId: number): Promise<{ nextWorkspaceId: number | null }> {
  return sendJson(`/api/workspaces/${workspaceId}`, 'DELETE')
}

export function updateMemberRole(workspaceId: number, userId: string, role: string): Promise<{ role: string }> {
  return sendJson(`/api/workspaces/${workspaceId}/members/${userId}`, 'PATCH', { role })
}

export function removeMember(workspaceId: number, userId: string): Promise<void> {
  return sendJson(`/api/workspaces/${workspaceId}/members/${userId}`, 'DELETE')
}

// --- App data ----------------------------------------------------------

export function getSessionCalendar(): Promise<SessionCalendar> {
  return getJson('/api/session-calendar')
}

export function getBills(): Promise<Bill[]> {
  return getJson('/api/bills')
}

export function getBillDetail(id: string): Promise<BillDetail> {
  return getJson(`/api/bills/${id}`)
}

export function getBrief(): Promise<Brief> {
  return getJson('/api/brief')
}

export function getHearings(): Promise<Hearing[]> {
  return getJson('/api/hearings')
}

export function getUpcomingHearings(): Promise<UpcomingHearing[]> {
  return getJson('/api/hearings/schedule')
}

export function getTeamBoard(): Promise<TeamBoardSummary> {
  return getJson('/api/team-board')
}

export function getWorkspaceMembers(): Promise<TeamMember[]> {
  return getJson('/api/workspace-members')
}

export function getMomentumFactors(): Promise<MomentumFactor[]> {
  return getJson('/api/momentum-factors')
}

export function getSavedViews(): Promise<SavedView[]> {
  return getJson('/api/saved-views')
}

export function getNavCounts(): Promise<NavCounts> {
  return getJson('/api/nav-counts')
}

export function setBillPosition(billId: string, position: Position): Promise<void> {
  return sendJson(`/api/bills/${billId}/position`, 'PATCH', { position })
}

export function setBillAssignee(billId: string, assigneeId: string | null): Promise<void> {
  return sendJson(`/api/bills/${billId}/assignee`, 'PATCH', { assigneeId })
}

export function createSavedView(name: string, color: string, query: string): Promise<SavedView> {
  return sendJson('/api/saved-views', 'POST', { name, color, query })
}

export function deleteSavedView(id: string): Promise<void> {
  return sendJson(`/api/saved-views/${id}`, 'DELETE')
}

export function getSessions(): Promise<LegislativeSession[]> {
  return getJson('/api/sessions')
}

export function getSessionBills(sessionId: string): Promise<SessionBillSummary[]> {
  return getJson(`/api/sessions/${sessionId}/bills`)
}

export function getLegislators(): Promise<LegislatorSummary[]> {
  return getJson('/api/legislators')
}

export function getLegislatorDetail(id: string): Promise<LegislatorDetail> {
  return getJson(`/api/legislators/${id}`)
}

export function getNotes(): Promise<Note[]> {
  return getJson('/api/notes')
}

export function getBillNotes(billId: string): Promise<Note[]> {
  return getJson(`/api/bills/${billId}/notes`)
}

export function createNote(params: {
  billId?: string | null
  body: string
  sourceHearing?: string | null
}): Promise<{ id: string; createdAt: string }> {
  return sendJson('/api/notes', 'POST', params)
}

export function deleteNote(id: string): Promise<void> {
  return sendJson(`/api/notes/${id}`, 'DELETE')
}

export function getSubjectCodes(): Promise<SubjectCode[]> {
  return getJson('/api/subject-codes')
}

export function getTags(): Promise<Tag[]> {
  return getJson('/api/tags')
}

export function getBillTags(billId: string): Promise<Tag[]> {
  return getJson(`/api/bills/${billId}/tags`)
}

export function tagBill(billId: string, name: string): Promise<Tag> {
  return sendJson(`/api/bills/${billId}/tags`, 'POST', { name })
}

export function untagBill(billId: string, tagId: string): Promise<void> {
  return sendJson(`/api/bills/${billId}/tags/${tagId}`, 'DELETE')
}

export function getSubjectWatches(): Promise<SubjectWatch[]> {
  return getJson('/api/subject-watches')
}

export function getSubjectWatchBills(watchId: string): Promise<SubjectWatchBillMatch[]> {
  return getJson(`/api/subject-watches/${watchId}/bills`)
}

export function createSubjectWatch(params: { name: string; subjectCodes: string[]; tagIds: string[] }): Promise<{ id: string; createdAt: string }> {
  return sendJson('/api/subject-watches', 'POST', params)
}

export function deleteSubjectWatch(id: string): Promise<void> {
  return sendJson(`/api/subject-watches/${id}`, 'DELETE')
}

export function getCommittees(): Promise<NonStandingCommittee[]> {
  return getJson('/api/committees')
}

export function getCommitteeDetail(id: string): Promise<NonStandingCommitteeDetail> {
  return getJson(`/api/committees/${id}`)
}

export function getFollowedCommittees(): Promise<FollowedCommittee[]> {
  return getJson('/api/followed-committees')
}

export function followCommittee(id: string): Promise<void> {
  return sendJson(`/api/committees/${id}/follow`, 'POST')
}

export function unfollowCommittee(id: string): Promise<void> {
  return sendJson(`/api/committees/${id}/follow`, 'DELETE')
}

export function getTestimony(): Promise<Testimony[]> {
  return getJson('/api/testimony')
}

export function getBillTestimony(billId: string): Promise<Testimony[]> {
  return getJson(`/api/bills/${billId}/testimony`)
}

export function createTestimony(params: {
  billId: string
  committeeMeetingId?: string | null
  position?: string | null
  body: string
}): Promise<{ id: string; createdAt: string }> {
  return sendJson('/api/testimony', 'POST', params)
}

export function updateTestimony(
  id: string,
  updates: { body?: string; position?: string | null; status?: string; committeeMeetingId?: string | null },
): Promise<{ id: string; updated: boolean }> {
  return sendJson(`/api/testimony/${id}`, 'PATCH', updates)
}

export function deleteTestimony(id: string): Promise<void> {
  return sendJson(`/api/testimony/${id}`, 'DELETE')
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function getTestimonyAttachmentUrl(id: string): string {
  return `${API_BASE}/api/testimony/${id}/attachment`
}

export async function uploadTestimonyAttachment(id: string, file: File): Promise<{ id: number; filename: string }> {
  const dataBase64 = await fileToBase64(file)
  return sendJson(`/api/testimony/${id}/attachment`, 'POST', { filename: file.name, mimeType: file.type, dataBase64 })
}

export function deleteTestimonyAttachment(id: string): Promise<void> {
  return sendJson(`/api/testimony/${id}/attachment`, 'DELETE')
}

export function sendBrief(): Promise<void> {
  return sendJson('/api/brief/send', 'POST')
}

export function trackBill(billId: string): Promise<void> {
  return sendJson(`/api/bills/${billId}/track`, 'POST')
}

export function untrackBill(billId: string): Promise<void> {
  return sendJson(`/api/bills/${billId}/track`, 'DELETE')
}

export type { Activity }
