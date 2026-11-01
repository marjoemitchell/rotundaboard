import type { Bill, Priority } from '../types'

// The priority options in order from the highest to the lowest.
export const PRIORITY_OPTIONS: { value: NonNullable<Priority>; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const PRIORITY_RANK: Record<NonNullable<Priority>, number> = { high: 0, medium: 1, low: 2 }

// The rank of a priority for a sort. A bill with no priority goes after a low priority bill.
export function priorityRank(priority: Priority): number {
  return priority ? PRIORITY_RANK[priority] : PRIORITY_OPTIONS.length
}

// Sorts the bills from the highest priority to the lowest. The sort is stable,
// so bills with the same priority keep their order.
export function sortByPriority<T extends Pick<Bill, 'priority'>>(bills: T[]): T[] {
  return [...bills].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
}

export function priorityLabel(priority: Priority): string {
  return PRIORITY_OPTIONS.find((opt) => opt.value === priority)?.label ?? 'No priority'
}
