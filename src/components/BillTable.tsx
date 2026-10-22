import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Bill, LoadState } from '../types'
import { InitialsSquare } from './shared/InitialsSquare'
import { MomentumBar } from './shared/MomentumBar'
import { PositionChip } from './shared/PositionChip'
import { EmptyState } from './shared/EmptyState'
import { plural } from '../lib/format'
import type { TeamMember } from '../types'
import styles from './BillTable.module.css'

type SortKey = 'identifier' | 'title' | 'sponsor' | 'position' | 'momentum'
type SortDir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'identifier', label: 'Bill', className: styles.billCol },
  { key: 'title', label: 'Title' },
  { key: 'sponsor', label: 'Sponsor', className: styles.sponsorCol },
  { key: 'position', label: 'Position', className: styles.positionCol },
  { key: 'momentum', label: 'Momentum' },
]

function sortValue(bill: Bill, key: SortKey): string | number {
  switch (key) {
    case 'identifier':
      return bill.identifier
    case 'title':
      return bill.title
    case 'sponsor':
      return bill.sponsor.name
    case 'position':
      return bill.position ?? ''
    case 'momentum':
      return bill.momentum.score
  }
}

export function BillTable({
  bills,
  closedBills = [],
  teamMembers,
  onSelectBill,
  onViewAll,
}: {
  /** The active bills. */
  bills: LoadState<Bill[]>
  /** Bills whose process is over. They show in a collapsed "Closed" group under the active bills. */
  closedBills?: Bill[]
  teamMembers: LoadState<TeamMember[]>
  onSelectBill: (id: string) => void
  onViewAll: () => void
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'momentum', dir: 'desc' })
  const [showClosed, setShowClosed] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)

  const memberById = useMemo(() => {
    const map = new Map<string, TeamMember>()
    if (teamMembers.status === 'ready') {
      for (const m of teamMembers.data) map.set(m.id, m)
    }
    return map
  }, [teamMembers])

  const sorted = useMemo(() => {
    if (bills.status !== 'ready') return []
    const list = [...bills.data]
    list.sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [bills, sort])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    )
  }

  const handleRowKeyDown = (e: KeyboardEvent, index: number, billId: string) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(index + 1, sorted.length - 1)
      setFocusedIndex(next)
      ;(e.currentTarget.parentElement?.children[next + 1] as HTMLElement | undefined)?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = Math.max(index - 1, 0)
      setFocusedIndex(prev)
      ;(e.currentTarget.parentElement?.children[prev + 1] as HTMLElement | undefined)?.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelectBill(billId)
    }
  }

  // The momentum column is always a number. A closed bill has no momentum: "—".
  // Its final status is in the last-action line.
  const momentum = (bill: Bill, closed: boolean) =>
    closed ? <span className={styles.noMomentum} aria-label="No momentum: closed">—</span> : <MomentumBar score={bill.momentum.score} />

  const renderRow = (bill: Bill, index: number, closed: boolean) => (
            <div
              key={bill.id}
              className={`${styles.row} ${closed ? styles.rowClosed : ''}`}
              role="row"
              tabIndex={closed ? 0 : index === focusedIndex ? 0 : -1}
              onFocus={() => !closed && setFocusedIndex(index)}
              onClick={() => onSelectBill(bill.id)}
              onKeyDown={(e) => {
                if (!closed) handleRowKeyDown(e, index, bill.id)
                else if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectBill(bill.id)
                }
              }}
              aria-rowindex={closed ? undefined : index + 2}
            >
              <div className={`${styles.cell} ${styles.billCol}`} role="gridcell">
                <div className={styles.cellStack}>
                  <span className={styles.billNumber}>{bill.identifier}</span>
                  {bill.requestNumber && <span className={styles.requestNumber}>{bill.requestNumber}</span>}
                </div>
              </div>
              <div className={styles.cell} role="gridcell">
                <div className={styles.cellStack}>
                  <span className={styles.inlineTopRow}>
                    <span className={styles.billNumber}>{bill.identifier}</span>
                    <span className={styles.inlineOutcome}>{momentum(bill, closed)}</span>
                  </span>
                  <span className={styles.billTitle}>{bill.title}</span>
                  <span className={styles.lastAction}>{bill.lastAction.text}</span>
                  <span className={`${styles.foldedLine} ${styles.showAt1180}`}>
                    {bill.sponsor.name || 'Not yet assigned'}
                    {bill.sponsor.district && ` · ${bill.sponsor.district}${bill.sponsor.party ? ` (${bill.sponsor.party})` : ''}`}
                    {' · '}
                    {bill.position ? bill.position : 'No position'}
                  </span>
                </div>
              </div>
              <div className={`${styles.cell} ${styles.sponsorCol}`} role="gridcell">
                <div className={styles.cellStack}>
                  <span className={styles.sponsorName}>{bill.sponsor.name || 'Not yet assigned'}</span>
                  {bill.sponsor.district && (
                    <span className={styles.sponsorMeta}>
                      {bill.sponsor.district}
                      {bill.sponsor.party ? ` (${bill.sponsor.party})` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className={`${styles.cell} ${styles.positionCol}`} role="gridcell">
                <PositionChip position={bill.position} />
              </div>
              <div className={`${styles.cell} ${styles.momentumCol}`} role="gridcell">
                <div className={styles.momentumCell}>{momentum(bill, closed)}</div>
              </div>
              <div className={`${styles.cell} ${styles.assigneeCol}`} role="gridcell">
                <InitialsSquare member={memberById.get(bill.assigneeId ?? '') ?? null} />
              </div>
            </div>
  )

  return (
    <section className={styles.section}>
      <div className={styles.wrap}>
        <div className={styles.grid} role="grid" aria-label="Tracked bills" aria-rowcount={sorted.length + 1}>
          <div className={styles.headerRow} role="row">
            {COLUMNS.map((col) => (
              <div key={col.key} role="columnheader" className={`${styles.headerCell} ${col.className ?? ''}`}>
                <button className={styles.sortButton} onClick={() => toggleSort(col.key)}>
                  {col.label}
                  <span className={`${styles.sortArrow} ${sort.key === col.key ? styles.sortArrowActive : ''}`}>
                    {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}
                  </span>
                </button>
              </div>
            ))}
            <div role="columnheader" className={`${styles.headerCell} ${styles.assigneeCol}`} aria-label="Assignee" />
          </div>

          {bills.status === 'loading' &&
            [0, 1, 2, 3, 4].map((i) => (
              <div className={styles.row} role="row" key={i}>
                <div className={`${styles.cell} ${styles.billCol}`} role="gridcell">
                  <div className="skeleton" style={{ height: 14, width: '80%' }} />
                </div>
                <div className={styles.cell} role="gridcell">
                  <div className="skeleton" style={{ height: 14, width: '90%' }} />
                </div>
                <div className={`${styles.cell} ${styles.sponsorCol}`} role="gridcell">
                  <div className="skeleton" style={{ height: 14, width: '70%' }} />
                </div>
                <div className={`${styles.cell} ${styles.positionCol}`} role="gridcell">
                  <div className="skeleton" style={{ height: 20, width: 60 }} />
                </div>
                <div className={styles.cell} role="gridcell">
                  <div className="skeleton" style={{ height: 4, width: '100%' }} />
                </div>
                <div className={`${styles.cell} ${styles.assigneeCol}`} role="gridcell">
                  <div className="skeleton" style={{ height: 24, width: 24 }} />
                </div>
              </div>
            ))}

          {bills.status === 'ready' && sorted.map((bill, index) => renderRow(bill, index, false))}

          {bills.status === 'empty' && closedBills.length > 0 && (
            <div className={styles.inlineEmpty}>No active tracked bills.</div>
          )}
          {closedBills.length > 0 && (
            <button
              className={styles.closedToggle}
              onClick={() => setShowClosed((v) => !v)}
              aria-expanded={showClosed}
            >
              <span>
                Closed · {closedBills.length}
              </span>
              <span aria-hidden="true">{showClosed ? '▴' : '▾'}</span>
            </button>
          )}
          {showClosed && closedBills.map((bill, index) => renderRow(bill, index, true))}
        </div>

        {bills.status === 'empty' && closedBills.length === 0 && (
          <EmptyState message="No bills match the current filters." />
        )}

        {bills.status === 'ready' && sorted.length > 0 && (
          <div className={styles.footer}>
            <button className={styles.footerLink} onClick={onViewAll}>
              {sorted.length === 1 ? 'View tracked bill →' : `View all ${plural(sorted.length, 'tracked bill')} →`}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
