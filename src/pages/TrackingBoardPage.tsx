import { useMemo } from 'react'
import type { Bill, LoadState, Position, TeamMember } from '../types'
import { InitialsSquare } from '../components/shared/InitialsSquare'
import { EmptyState } from '../components/shared/EmptyState'
import { OutcomeBadge } from '../components/shared/OutcomeBadge'
import styles from './TrackingBoardPage.module.css'

const COLUMNS: { key: Position; label: string }[] = [
  { key: null, label: 'No position' },
  { key: 'support', label: 'Support' },
  { key: 'oppose', label: 'Oppose' },
  { key: 'watch', label: 'Watch' },
  { key: 'neutral', label: 'Neutral' },
]

function BoardCard({
  bill,
  assignee,
  teamMembers,
  onSelectBill,
  onChangePosition,
  onChangeAssignee,
}: {
  bill: Bill
  assignee: TeamMember | null
  teamMembers: LoadState<TeamMember[]>
  onSelectBill: (id: string) => void
  onChangePosition: (billId: string, position: Position) => void
  onChangeAssignee: (billId: string, assigneeId: string | null) => void
}) {
  return (
    <div className={styles.card}>
      <button className={styles.cardMain} onClick={() => onSelectBill(bill.id)}>
        <div className={styles.cardHead}>
          <span className={styles.cardIdentifier}>{bill.identifier}</span>
          {bill.outcome ? <OutcomeBadge outcome={bill.outcome} /> : <span className={styles.cardMomentum}>{bill.momentum.score}</span>}
        </div>
        <div className={styles.cardTitle}>{bill.title}</div>
        <div className={styles.cardStatus}>{bill.status}</div>
        <div className={styles.cardSponsor}>{bill.sponsor.name || 'Not yet assigned'}</div>
      </button>
      <div className={styles.cardControls}>
        <span className={styles.assigneeControl}>
          <InitialsSquare member={assignee} size={20} />
          <select
            className={styles.cardSelect}
            value={bill.assigneeId ?? ''}
            onChange={(e) => onChangeAssignee(bill.id, e.target.value || null)}
            aria-label={`Assignee for ${bill.identifier}`}
          >
            <option value="">Unassigned</option>
            {teamMembers.status === 'ready' &&
              teamMembers.data.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </span>
        <select
          className={styles.cardSelect}
          value={bill.position ?? ''}
          onChange={(e) => onChangePosition(bill.id, (e.target.value || null) as Position)}
          aria-label={`Move ${bill.identifier} to a different position`}
        >
          {COLUMNS.map((col) => (
            <option key={col.label} value={col.key ?? ''}>
              Move: {col.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function TrackingBoardPage({
  bills,
  teamMembers,
  onSelectBill,
  onChangePosition,
  onChangeAssignee,
}: {
  bills: LoadState<Bill[]>
  teamMembers: LoadState<TeamMember[]>
  onSelectBill: (id: string) => void
  onChangePosition: (billId: string, position: Position) => void
  onChangeAssignee: (billId: string, assigneeId: string | null) => void
}) {
  const memberById = useMemo(() => {
    const map = new Map<string, TeamMember>()
    if (teamMembers.status === 'ready') for (const m of teamMembers.data) map.set(m.id, m)
    return map
  }, [teamMembers])

  const grouped = useMemo(() => {
    const map = new Map<Position, Bill[]>()
    for (const col of COLUMNS) map.set(col.key, [])
    if (bills.status === 'ready') {
      for (const b of bills.data) {
        const key = b.position ?? null
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(b)
      }
    }
    return map
  }, [bills])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Tracking board</h1>
      <p className={styles.subhead}>Every tracked bill, grouped by where the coalition currently stands on it.</p>

      {bills.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
      {bills.status === 'empty' && (
        <EmptyState message="No bills are being tracked yet. Track a bill to see it here." />
      )}

      {bills.status === 'ready' && (
        <div className={styles.board}>
          {COLUMNS.map((col) => {
            const colBills = grouped.get(col.key) ?? []
            return (
              <div key={col.label} className={styles.column}>
                <div className={styles.columnHead}>
                  <span className={styles.columnLabel}>{col.label}</span>
                  <span className={styles.columnCount}>{colBills.length}</span>
                </div>
                <div className={styles.columnBody}>
                  {colBills.length === 0 && <div className={styles.columnEmpty}>No bills</div>}
                  {colBills.map((bill) => (
                    <BoardCard
                      key={bill.id}
                      bill={bill}
                      assignee={memberById.get(bill.assigneeId ?? '') ?? null}
                      teamMembers={teamMembers}
                      onSelectBill={onSelectBill}
                      onChangePosition={onChangePosition}
                      onChangeAssignee={onChangeAssignee}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
