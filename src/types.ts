export type Party = 'R' | 'D' | 'I'

export type Position = 'support' | 'oppose' | 'watch' | 'neutral' | null

export type Chamber = 'house' | 'senate'

export interface Sponsor {
  name: string
  district: string
  party: Party
}

export interface Momentum {
  score: number
  delta7d: number
  history: number[]
}

// A bill's legislative process is over once it's become law, or once its
// session adjourned without that happening — at that point the live
// momentum score is misleading and the UI shows this static outcome
// instead. null means the bill is still active (still show momentum).
export type BillOutcome = 'became_law' | 'failed' | 'died' | null

export interface Bill {
  id: string
  identifier: string // "LC 0412" or "HB 512"
  requestNumber?: string // "req. 2026-0412"
  officialUrl: string | null
  title: string
  sponsor: Sponsor
  committee?: string
  chamber?: Chamber
  // Every subject code Montana's own data has tagged this bill with — there's
  // no reliable "primary" one (see server/src/api/queries.ts), so this is
  // the full list rather than one arbitrarily chosen subject.
  subjects: string[]
  status: string
  lastAction: { text: string; date: string }
  position: Position
  assigneeId: string | null
  momentum: Momentum
  outcome: BillOutcome
}

export interface BillStatusEvent {
  id: string
  occurredAt: string
  status: string
  progressCategory: string | null
  committee: string | null
  result: string | null
}

export interface VoteTally {
  yes: number
  no: number
  other: number
}

export interface LegislatorVote {
  legislatorId: number
  name: string
  party: string | null
  voteType: string | null
}

export interface BillVote {
  id: string
  motion: string | null
  occurredAt: string | null
  chamber: string | null
  result: string | null
  tally: VoteTally
  legislatorVotes: LegislatorVote[]
}

export interface ExecutiveAction {
  id: string
  motion: string | null
  voteTime: string | null
  committee: string | null
  tally: VoteTally
  legislatorVotes: LegislatorVote[]
}

export interface Cosponsor {
  legislatorId: number
  name: string
  district: string | null
  party: string | null
}

export interface BillHearingRecord {
  id: string
  committee: string | null
  datetime: string | null
  room: string | null
}

export interface Amendment {
  id: string
  number: number | null
  type: string | null
  billVersion: number | null
}

export interface AiSummary {
  text: string
  model: string | null
  generatedAt: string | null
}

export interface BillDetail extends Bill {
  draftNumber: string
  isTracked: boolean
  aiSummary: AiSummary | null
  statusHistory: BillStatusEvent[]
  votes: BillVote[]
  executiveActions: ExecutiveAction[]
  cosponsors: Cosponsor[]
  hearings: BillHearingRecord[]
  amendments: Amendment[]
}

export interface LegislativeSession {
  id: string
  ordinals: string // "20251"
  legislatureOrdinal: number // 69
  startDate: string | null
  sineDieDate: string | null
  status: 'upcoming' | 'active' | 'past'
  billCount: number
  trackedCount: number
}

export interface SessionBillSummary {
  id: string
  identifier: string
  title: string
  sponsor: string
  party: string | null
  status: string
  isTracked: boolean
}

export interface SubjectWatchBillMatch extends SessionBillSummary {
  // Which of the watch's subject codes this specific bill carries — a bill
  // can match a watch through a subject that's incidental to it (see
  // getSubjectWatchBills in queries.ts), so this is shown so users can judge
  // relevance for themselves rather than trusting the match blindly.
  matchedSubjects: string[]
  // Total subject codes tagged on the bill overall — results are ordered by
  // this ascending, since a bill carrying only one or two tags overall is a
  // much stronger signal that a matched subject is actually central to it.
  subjectCount: number
}

export interface Tag {
  id: string
  name: string
  usageCount?: number
}

export interface SubjectCode {
  code: string
  description: string
}

export interface SubjectWatch {
  id: string
  name: string
  subjectCodes: SubjectCode[]
  tags: Tag[]
  matchCount: number
  untrackedCount: number
  createdAt: string
}

export interface NonStandingCommittee {
  id: string
  name: string
  committeeType: string | null
  memberCount: number
  nextMeetingAt: string | null
  isFollowed: boolean
}

export interface CommitteeMember {
  legislatorId: string | null
  name: string
  party: string | null
  roleName: string | null
}

export interface CommitteeAgendaItem {
  id: number
  title: string
  description: string
}

export interface CommitteeMeeting {
  id: string
  meetingTime: string | null
  meetingEndTime: string | null
  location: string | null
  comments: string | null
  publicParticipation: boolean | null
  status: string | null
  agendaItems: CommitteeAgendaItem[]
}

export interface NonStandingCommitteeDetail {
  id: string
  name: string
  committeeType: string | null
  isFollowed: boolean
  meetingMaterialsHtml: string | null
  members: CommitteeMember[]
  meetings: CommitteeMeeting[]
}

export interface UpcomingHearing {
  id: string
  committeeId: string
  committee: string
  meetingTime: string
  location: string | null
  publicParticipation: boolean | null
  agendaCount: number
  isFollowed: boolean
}

export interface FollowedCommittee {
  id: string
  name: string
  nextMeetingAt: string | null
  nextLocation: string | null
}

export interface LegislatorSummary {
  id: string
  name: string
  chamber: Chamber | null
  party: string | null
  district: string | null
  legislatureOrdinal: number | null
  sponsoredCount: number
}

export interface LegislatorBillLine {
  id: string
  identifier: string
  title: string | null
}

export interface LegislatorCommitteeMembership {
  name: string
  role: string | null
  type: 'standing' | 'interim'
}

export interface LegislatorVoteLine extends LegislatorBillLine {
  occurredAt: string | null
  voteType: string | null
}

export interface LegislatorDetail {
  id: string
  name: string
  chamber: Chamber | null
  party: string | null
  district: string | null
  email: string | null
  legislatureOrdinal: number | null
  sponsoredBills: LegislatorBillLine[]
  cosponsoredBills: LegislatorBillLine[]
  committees: LegislatorCommitteeMembership[]
  recentVotesTally: VoteTally
  recentVotes: LegislatorVoteLine[]
}

export interface TeamMember {
  id: string
  name: string
  initials: string
  color: string
}

export type Role = 'admin' | 'member'

export interface AuthWorkspace {
  id: number
  name: string
  role: Role
}

export interface AuthSession {
  user: { id: number; email: string; name: string; initials: string; color: string }
  currentWorkspace: { id: number; name: string } | null
  role: Role | null
  workspaces: AuthWorkspace[]
}

export interface WorkspaceMemberDetail {
  id: string
  name: string
  email: string
  initials: string
  color: string
  role: Role
}

export interface WorkspaceInvite {
  id: string
  email: string
  role: Role
  createdAt: string
  expiresAt: string
}

export interface InviteLookup {
  workspaceName: string
  email: string
  role: Role
  accountExists: boolean
}

export interface SessionCalendar {
  sessionNumber: number | null
  convenesOn: string | null
  daysToConvene: number | null
  lcDraftsFiled: number
  lcDraftsDelta7d: number
  draftRequestDeadline: string | null
  hearingsNext30Days: number
  hearingCommittees: string[]
  daysToTransmittal: number | null
  transmittalDate: string | null
}

export interface TranscriptSegment {
  timestamp: number // seconds
  speaker: string
  text: string
}

export interface Hearing {
  id: string
  committee: string
  datetime: string
  room: string
  durationSeconds: number
  transcriptStatus: 'pending' | 'processing' | 'ready'
  audioUrl?: string
  waveform: number[] // relative amplitude 0-1
  transcript: TranscriptSegment[]
  trackedTermMentions: number
}

export interface BriefTaggedItem {
  tag: 'RISK' | 'NEW' | 'CAL'
  text: string
  sourceIds: string[]
}

export interface Brief {
  generatedAt: string
  summary: string
  boldedBillIds: string[]
  taggedItems: BriefTaggedItem[]
  sourceCounts: { actions: number; hearings: number; fiscalNotes: number }
}

export interface Activity {
  id: string
  actorId: string
  verb: string
  detail: string
  billId?: string
  timestamp: string
}

export interface TeamBoardSummary {
  activity: Activity[]
  toReview: number
  testimonyDrafts: number
  overdue: number
}

export interface SavedView {
  id: string
  name: string
  color: string
  query: string
}

export interface MomentumFactor {
  weight: number
  label: string
}

export interface NavCounts {
  allBills: number
  lcDrafts: number
  introduced: number
  hearings: number
  legislators: number
  trackingBoard: number
  notes: number
  subjectWatches: number
  interimCommittees: number
  testimony: number
  digests: number
}

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; data: T }

export interface DigestHighlight {
  billId: string
  identifier: string
  title: string
  detail: string
}

export interface DigestSection {
  title: string
  items: string[]
}

export interface Digest {
  id: string
  periodStart: string
  periodEnd: string
  summary: string
  highlights: DigestHighlight[]
  sections: DigestSection[]
  createdByName: string | null
  createdAt: string
}

export type TestimonyStatus = 'draft' | 'submitted' | 'delivered'

export interface Testimony {
  id: string
  billId: string
  billIdentifier: string
  billTitle: string
  committeeMeetingId: string | null
  committeeName: string | null
  hearingTime: string | null
  authorId: string | null
  authorName: string | null
  position: Position
  status: TestimonyStatus
  body: string
  attachmentFilename: string | null
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  billId: string | null
  billIdentifier: string | null
  billTitle: string | null
  authorId: string | null
  authorName: string | null
  body: string
  sourceHearing: string | null
  createdAt: string
}

export interface FilterState {
  status?: string
  subject?: string
  position?: string
  momentumMin?: string
  committee?: string
  chamber?: string
  sponsor?: string
  party?: string
  lastActionWithin?: string
  assignee?: string
}
