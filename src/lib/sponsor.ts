import type { Bill } from '../types'

// The text for the sponsor of a bill in a list. An LC draft has a requester,
// not a sponsor, so the text names the requester.
export function sponsorOrRequester(bill: Pick<Bill, 'isDraft' | 'requester' | 'sponsor'>): string {
  if (bill.isDraft) return bill.requester ? `Requested by ${bill.requester.name}` : 'Requester not known'
  return bill.sponsor.name || 'Not yet assigned'
}
