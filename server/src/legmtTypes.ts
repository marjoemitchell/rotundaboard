// Shapes of the JSON returned by bearbeta.legmt.gov. These are reverse-engineered
// from live responses (the API has no published schema) and only declare the
// fields we actually consume — the real payloads carry more.

export interface RawLegislature {
  id: number
  ordinals: string
  startDate: string | null
  endDate: string | null
}

export interface RawSession {
  id: number
  ordinals: string
  active: boolean
  firstCountDate: string | null
  secondCountDate: string | null
  startDate: string | null
  sineDieDate: string | null
  type: string
  legislature: RawLegislature
}

export interface RawPoliticalParty {
  id: number
  code: string
  name: string
}

export interface RawDistrict {
  id: number
  chamber: string | null
  number: number | null
  name: string | null
}

export interface RawLegislator {
  id: number
  firstName: string | null
  lastName: string | null
  middleName: string | null
  displayName: string | null
  chamber: string | null
  emailAddress: string | null
  startDate: string | null
  endDate: string | null
  legislature: RawLegislature | null
  politicalParty: RawPoliticalParty | null
  district: RawDistrict | null
}

export interface RawCommitteeMembership {
  id: number
  type: { id: number; code: string; name: string }
  legislatorId: number
  startDate: string | null
  endDate: string | null
}

export interface RawStandingCommittee {
  id: number
  sessionId: number
  chamber: string | null
  memberships: RawCommitteeMembership[]
  committeeDetails: {
    defaultRoom: string | null
    defaultDays: string | null
    defaultTime: string | null
    committeeCode: {
      id: number
      code: string
      name: string
      committeeType: { id: number; code: string; description: string } | null
    }
  }
}

export interface RawProgressCategory {
  id: number
  code: number
  description: string
  sortOrder: number
}

export interface RawBillStatusCode {
  id: number
  code: string
  name: string
  chamber: string | null
  actionWeight: string | null
  billProgressCategory: RawProgressCategory | null
}

export interface RawBillStatus {
  id: number
  timeStamp: string
  standingCommitteeId: number | null
  billStatusCode: RawBillStatusCode | null
  billProgressCategory: RawProgressCategory | null
  vote: unknown
  scheduledBillHearingId: number | null
  executiveActionId: number | null
  result: string | null
}

export interface RawSubjectCode {
  id: number
  code: string
  description: string
  primary: boolean | null
}

export interface RawDraftSubject {
  id: number
  subjectCode: RawSubjectCode
}

export interface RawDraft {
  id: number
  draftNumber: string
  date: string | null
  shortTitle: string | null
  description: string | null
  requesterId: number | null
  requesterType: string | null
  billStatuses: RawBillStatus[]
  legalNote: boolean | null
  sessionId: number
  fiscalNote: boolean | null
  fiscalAnalystId: number | null
  preIntroRequired: boolean | null
  subjects: RawDraftSubject[]
}

export interface RawBillType {
  id: number
  description: string
  code: string
  sortOrder: number
  chamber: string
}

export interface RawBill {
  id: number
  deadlineCodeId: number | null
  billNumber: number | null
  sponsorId: number | null
  carrierId: number | null
  drafterStaffMemberId: number | null
  billType: RawBillType | null
  draft: RawDraft
  enrolled: boolean | null
  versionNumber: number | null
  sessionLawChapter: string | null
  sessionId: number
  sessionLawChapterNumber: number | null
}

export interface RawBillFilterPage {
  content: RawBill[]
  totalElements: number
}

export interface RawLegislatorVote {
  id: number
  legislatorId: number
  voteType: string | null
  votingMemberStatus: string | null
}

export interface RawBillVote {
  id: number
  motion: string | null
  orderOfBusinessId: number | null
  dateTime: string | null
  sessionId: number
  amendmentNumber: string | number | null
  voteMotion: string | null
  legislatorVotes: RawLegislatorVote[]
  billStatus: { id: number; result: string | null } | null
  systemId: { chamber: string | null; sequence: number | null } | null
}

export interface RawCommitteeMeeting {
  id: number
  meetingTime: string | null
  location: string | null
  comments: string | null
  publicParticipation: boolean | null
  billTestimony: boolean | null
  status: string | null
  standingCommittee: { id: number } | null
}

export interface RawCommitteeMeetingBillHearing {
  id: number
  committeeMeeting: RawCommitteeMeeting
}

export interface RawExecutiveActionLegislatorVote {
  id: number
  membership: { legislatorId: number; type: { code: string; name: string } | null } | null
  committeeVote: string | null
}

export interface RawExecutiveAction {
  id: number
  billId: number
  standingCommitteeMeeting: RawCommitteeMeeting | null
  voteTime: string | null
  motion: string | null
  billStatusId: number | null
  legislatorVotes: RawExecutiveActionLegislatorVote[]
}

export interface RawAmendment {
  id: number
  drafterStaffMemberId: number | null
  billVersion: number | null
  number: number | null
  requestorId: number | null
  section: string | null
  type: string | null
}

export interface RawBillCosponsor {
  id: number
  cosponsorId: number
}

export interface RawNonStandingCommittee {
  id: number
  legislatureId: number
  memberships: RawCommitteeMembership[]
  committeeDetails: {
    committeeCode: {
      id: number
      code: string
      name: string
      committeeType: { id: number; code: string; description: string } | null
    }
  }
}

export interface RawAgendaItem {
  id: number
  orderNumber: number | null
  title: string | null
  description: string | null
}

export interface RawNonStandingCommitteeMeeting {
  id: number
  meetingTime: string | null
  meetingEndTime: string | null
  location: string | null
  comments: string | null
  publicParticipation: boolean | null
  status: string | null
  agendaItems: RawAgendaItem[]
  nonStandingCommittee: { id: number } | null
}

export interface RawNonStandingCommitteeMeetingPage {
  content: RawNonStandingCommitteeMeeting[]
  totalElements: number
}

// From www.legmt.gov's WordPress CMS (a different host/API entirely from
// bearbeta.legmt.gov) — each committee has editorial content tabs
// ("Meeting Materials", "Studies / Topics", etc.) authored by legislative
// staff as rich HTML, with embedded links to the actual PDF documents
// (agendas, exhibits, reports). This is genuinely separate from the
// structured agendaItems on a meeting — a meeting can show 0 agendaItems
// while still having a real agenda published here as a linked PDF.
export interface RawCommitteeTabLayout {
  layout: string
  content: string | null
}

export interface RawCommitteeTabSection {
  sectionTitle: string | null
  layouts: RawCommitteeTabLayout[]
}

export interface RawCommitteeTab {
  tabTitle: string
  sections: RawCommitteeTabSection[]
}

export interface RawCommitteeTabsResponse {
  lawsId: number
  title: string
  tabs: RawCommitteeTab[]
}
