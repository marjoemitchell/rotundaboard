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
  /** The section letter of a large bill (HB 2 uses A to E). */
  section: string | null
  /** The amendment file with the text changes, when the text job has it. */
  documentId: string | null
  /** A plain-language summary of the amendment (AI-generated). */
  summary: string | null
  postedAt: string | null
}

/** One version of the bill text: '1' (introduced), '2', ..., 'X' (enrolled). */
export interface BillTextVersion {
  key: string
  label: string
  postedAt: string | null
}

/** A mark in bill text: 0 none, 1 struck (removed from the law), 2 underlined (new law). */
export type TextMark = 0 | 1 | 2 | 3
/** Words with one mark. "\n" is a paragraph break. */
export type TextRun = [text: string, mark: TextMark]

export interface TextDiffPart {
  op: '=' | '-' | '+'
  runs: TextRun[]
}

export interface BillComparison {
  from: BillTextVersion
  to: BillTextVersion
  parts: TextDiffPart[]
}

export interface AmendmentChanges {
  summary: string | null
  baseVersion: { key: string; label: string }
  /** Only the changed paragraphs. */
  paragraphs: TextDiffPart[][]
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
  textVersions: BillTextVersion[]
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
  endTimestamp: number
  // null for caption-sourced segments (no diarization yet)
  speaker: string | null
  legislatorId: string | null
  text: string
  // Tracked bills (by id) this segment mentions, e.g. "House Bill 123".
  mentionedBillIds: string[]
}

// 'processing' = the archive's own captions only (no speakers yet);
// 'ready' = our diarized, speaker-attributed transcript; 'failed' = the
// diarized pass gave up, captions (if any) remain.
export type TranscriptStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface HearingSummary {
  id: string
  committee: string
  committeeId: string | null
  meetingId: string | null
  datetime: string
  room: string | null
  durationSeconds: number
  transcriptStatus: TranscriptStatus
  transcriptSource: 'captions' | 'diarized' | null
  isFollowed: boolean
  // True when one or more speakers have a name, not only "Speaker N".
  speakersNamed: boolean
  // The recording's page on the Legislature's own video archive.
  sourceUrl: string
}

export interface Hearing extends HearingSummary {
  audioUrl: string | null
  waveform: number[] // relative amplitude 0-1
  transcript: TranscriptSegment[]
  trackedTermMentions: number
  aiSummary: HearingAiSummary | null
}

/** An AI summary of a hearing transcript. A time is in seconds from the start. */
export interface HearingAiSummary {
  overview: string
  topics: { title: string; summary: string; startSeconds: number | null }[]
  actions: { text: string; startSeconds: number | null }[]
  model: string | null
  generatedAt: string | null
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
}

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; data: T }


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

// Email change alerts (server/src/alerts.ts). delivery applies to the user
// everywhere; the switches are per workspace.
export type AlertDelivery = 'immediate' | 'daily' | 'off'

export interface AlertSource {
  id: string
  name: string
  enabled: boolean
}

export interface NotificationPreferences {
  delivery: AlertDelivery
  // A reminder about 24 hours before each hearing.
  hearingReminders: boolean
  trackedBills: boolean
  subjectWatches: AlertSource[]
  followedCommittees: AlertSource[]
}

export type AlertSourceType = 'tracked_bills' | 'subject_watch' | 'followed_committee'

// How recent the scraped Legislature data is (server/src/scrapeHealth.ts).
export interface DataFreshnessJob {
  job: string
  label: string
  lastSuccessAt: string | null
  lastRunAt: string | null
  lastRunFailed: boolean
  stale: boolean
}

export interface DataFreshness {
  status: 'fresh' | 'stale' | 'failing' | 'unknown'
  lastSuccessfulScrape: string | null
  jobs: DataFreshnessJob[]
}

/** All values for the dashboard filter menus, not only the values of tracked bills. */
export interface FilterOptions {
  statuses: string[]
  subjects: string[]
  committees: string[]
  sponsors: string[]
  parties: string[]
}
