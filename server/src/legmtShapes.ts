// Runtime shape checks for bearbeta.legmt.gov responses (see
// scrapeHealth.ts). Each shape lists only the fields that the scrapers
// read, with the same types as legmtTypes.ts. The API sends more fields than
// these, and the checks ignore the other fields.
//
// Notation:
//   'string' | 'number' | 'boolean'   the field must have this type
//   'string?' (and so on)              the field can also be null or missing
//   'any'                              the field must exist, with any value
//   { ... }                            a required object with these fields
//   nullable({ ... })                  an object, or null, or missing
//   [shape]                            an array, each item has this shape

export type Shape =
  | 'string'
  | 'number'
  | 'boolean'
  | 'any'
  | 'string?'
  | 'number?'
  | 'boolean?'
  | { [field: string]: Shape }
  | Shape[]
  | { $nullable: Shape }

export function nullable(shape: Shape): Shape {
  return { $nullable: shape }
}

const legislature = { id: 'number', ordinals: 'string', startDate: 'string?', endDate: 'string?' } satisfies Shape

const session = {
  id: 'number',
  ordinals: 'string',
  firstCountDate: 'string?',
  secondCountDate: 'string?',
  startDate: 'string?',
  sineDieDate: 'string?',
  type: 'string',
  legislature,
} satisfies Shape

const legislator = {
  id: 'number',
  firstName: 'string?',
  lastName: 'string?',
  middleName: 'string?',
  displayName: 'string?',
  chamber: 'string?',
  emailAddress: 'string?',
  startDate: 'string?',
  endDate: 'string?',
  legislature: nullable(legislature),
  politicalParty: nullable({ id: 'number', code: 'string', name: 'string' }),
  district: nullable({ id: 'number', chamber: 'string?', number: 'number?', name: 'string?' }),
} satisfies Shape

const membership = {
  id: 'number',
  type: { id: 'number', code: 'string', name: 'string' },
  legislatorId: 'number',
  startDate: 'string?',
  endDate: 'string?',
} satisfies Shape

const committeeCode = {
  id: 'number',
  code: 'string',
  name: 'string',
  committeeType: nullable({ id: 'number', code: 'string', description: 'string' }),
} satisfies Shape

const standingCommittee = {
  id: 'number',
  sessionId: 'number',
  chamber: 'string?',
  memberships: [membership],
  committeeDetails: { defaultRoom: 'string?', defaultDays: 'string?', defaultTime: 'string?', committeeCode },
} satisfies Shape

const nonStandingCommittee = {
  id: 'number',
  legislatureId: 'number',
  memberships: [membership],
  committeeDetails: { committeeCode },
} satisfies Shape

const progressCategory = { id: 'number', code: 'number', description: 'string', sortOrder: 'number?' } satisfies Shape

const billStatus = {
  id: 'number',
  timeStamp: 'string',
  standingCommitteeId: 'number?',
  billStatusCode: nullable({
    id: 'number',
    code: 'string',
    name: 'string',
    chamber: 'string?',
    actionWeight: 'string?',
    billProgressCategory: nullable(progressCategory),
  }),
  billProgressCategory: nullable(progressCategory),
  scheduledBillHearingId: 'number?',
  executiveActionId: 'number?',
  result: 'string?',
} satisfies Shape

const bill = {
  id: 'number',
  deadlineCodeId: 'number?',
  billNumber: 'number?',
  sponsorId: 'number?',
  carrierId: 'number?',
  drafterStaffMemberId: 'number?',
  billType: nullable({ id: 'number', description: 'string', code: 'string', sortOrder: 'number', chamber: 'string' }),
  draft: {
    id: 'number',
    draftNumber: 'string',
    date: 'string?',
    shortTitle: 'string?',
    description: 'string?',
    requesterId: 'number?',
    requesterType: 'string?',
    billStatuses: [billStatus],
    legalNote: 'boolean?',
    sessionId: 'number',
    fiscalNote: 'boolean?',
    fiscalAnalystId: 'number?',
    preIntroRequired: 'boolean?',
    subjects: [{ id: 'number', subjectCode: { id: 'number', code: 'string', description: 'string', primary: 'boolean?' } }],
  },
  enrolled: 'boolean?',
  versionNumber: 'number?',
  sessionLawChapter: nullable({ number: 'number?', assignedDate: 'string?' }),
  sessionId: 'number',
  sessionLawChapterNumber: 'number?',
} satisfies Shape

const committeeMeeting = {
  id: 'number',
  meetingTime: 'string?',
  location: 'string?',
  comments: 'string?',
  publicParticipation: 'boolean?',
  billTestimony: 'boolean?',
  status: 'string?',
  standingCommittee: nullable({ id: 'number' }),
} satisfies Shape

const billVote = {
  id: 'number',
  motion: 'string?',
  orderOfBusinessId: 'number?',
  dateTime: 'string?',
  sessionId: 'number',
  amendmentNumber: 'any',
  voteMotion: 'string?',
  legislatorVotes: [{ id: 'number', legislatorId: 'number', voteType: 'string?', votingMemberStatus: 'string?' }],
  billStatus: nullable({ id: 'number', result: 'string?' }),
  systemId: nullable({ chamber: 'string?', sequence: 'number?' }),
} satisfies Shape

const executiveAction = {
  id: 'number',
  billId: 'number',
  standingCommitteeMeeting: nullable(committeeMeeting),
  voteTime: 'string?',
  motion: 'string?',
  billStatusId: 'number?',
  legislatorVotes: [
    {
      id: 'number',
      membership: nullable({ legislatorId: 'number', type: nullable({ code: 'string', name: 'string' }) }),
      committeeVote: 'string?',
    },
  ],
} satisfies Shape

const amendment = {
  id: 'number',
  drafterStaffMemberId: 'number?',
  billVersion: 'number?',
  number: 'number?',
  requestorId: 'number?',
  section: 'string?',
  type: 'string?',
} satisfies Shape

const nonStandingCommitteeMeeting = {
  id: 'number',
  meetingTime: 'string?',
  meetingEndTime: 'string?',
  location: 'string?',
  comments: 'string?',
  publicParticipation: 'boolean?',
  status: 'string?',
  agendaItems: [{ id: 'number', orderNumber: 'number?', title: 'string?', description: 'string?' }],
  nonStandingCommittee: nullable({ id: 'number' }),
} satisfies Shape

const committeeTabs = {
  lawsId: 'number',
  title: 'string',
  tabs: [{ tabTitle: 'string', sections: [{ sectionTitle: 'string?', layouts: [{ layout: 'string', content: 'string?' }] }] }],
} satisfies Shape

const billDocument = { id: 'number', fileName: 'string', date: 'string?', creation: 'string?' } satisfies Shape

export interface EndpointSpec {
  /** The shape of one item. A list endpoint checks each item. */
  item: Shape
  /** True if a complete run must receive one or more items from this endpoint. */
  expectItems: boolean
}

// Keys are the endpoint names that legmtClient.ts reports.
export const ENDPOINTS: Record<string, EndpointSpec> = {
  sessions: { item: session, expectItems: true },
  legislators: { item: legislator, expectItems: true },
  standingCommittees: { item: standingCommittee, expectItems: true },
  nonStandingCommittees: { item: nonStandingCommittee, expectItems: true },
  bills: { item: bill, expectItems: true },
  billVotes: { item: billVote, expectItems: false },
  amendments: { item: amendment, expectItems: false },
  cosponsors: { item: { id: 'number', cosponsorId: 'number' }, expectItems: false },
  billHearings: { item: { id: 'number', status: 'string?', committeeMeeting }, expectItems: false },
  billHearingSearch: { item: { id: 'number', billId: 'number', status: 'string?', committeeMeeting }, expectItems: false },
  executiveActions: { item: executiveAction, expectItems: false },
  billVersionDocuments: { item: billDocument, expectItems: false },
  billAmendmentDocuments: { item: billDocument, expectItems: false },
  nonStandingCommitteeMeetings: { item: nonStandingCommitteeMeeting, expectItems: false },
  committeeTabs: { item: committeeTabs, expectItems: false },
}
