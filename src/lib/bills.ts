import type { Bill } from '../types'

/**
 * True when the process of the bill is over. The server sets `closed` from
 * the Legislature's progress categories, not from the status text: the bill
 * became law, its latest status is a final one (died, vetoed, withdrawn,
 * missed a transmittal deadline), or its session ended.
 */
export function isClosed(bill: Bill): boolean {
  return bill.closed || bill.outcome != null
}
