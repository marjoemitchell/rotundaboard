import { useMemo } from 'react'
import type { Bill, FilterState, LoadState, TeamMember } from '../types'
import styles from './FilterBar.module.css'

type FilterKey = keyof FilterState

interface FilterDef {
  key: FilterKey
  label: string
  options: { value: string; label: string }[]
}

function unique(values: (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort()
}

function useFilterDefs(bills: Bill[], teamMembers: TeamMember[]): FilterDef[] {
  return useMemo(
    (): FilterDef[] => [
      {
        key: 'status',
        label: 'Status',
        options: unique(bills.map((b) => b.status)).map((v) => ({ value: v, label: v })),
      },
      {
        key: 'assignee',
        label: 'Assignee',
        options: teamMembers.map((m) => ({ value: m.id, label: m.name })),
      },
      {
        key: 'subject',
        label: 'Subject',
        options: unique(bills.map((b) => b.subject)).map((v) => ({ value: v, label: v })),
      },
      {
        key: 'position',
        label: 'Position',
        options: [
          { value: 'support', label: 'Support' },
          { value: 'oppose', label: 'Oppose' },
          { value: 'watch', label: 'Watch' },
          { value: 'neutral', label: 'Neutral' },
        ],
      },
      {
        key: 'momentumMin',
        label: 'Momentum',
        options: ['40', '50', '60', '70', '80'].map((v) => ({ value: v, label: `≥ ${v}` })),
      },
      {
        key: 'committee',
        label: 'Committee',
        options: unique(bills.map((b) => b.committee)).map((v) => ({ value: v, label: v })),
      },
      {
        key: 'chamber',
        label: 'Chamber',
        options: [
          { value: 'house', label: 'House' },
          { value: 'senate', label: 'Senate' },
        ],
      },
      {
        key: 'sponsor',
        label: 'Sponsor',
        options: unique(bills.map((b) => b.sponsor.name)).map((v) => ({ value: v, label: v })),
      },
      {
        key: 'party',
        label: 'Party',
        options: unique(bills.map((b) => b.sponsor.party)).map((v) => ({ value: v, label: v })),
      },
      {
        key: 'lastActionWithin',
        label: 'Last action',
        options: ['7', '14', '30', '90'].map((v) => ({ value: v, label: `Last ${v} days` })),
      },
    ],
    [bills, teamMembers],
  )
}

export function FilterBar({
  bills,
  teamMembers,
  filters,
  onSetFilter,
  onRemoveFilter,
  onSaveView,
}: {
  bills: LoadState<Bill[]>
  teamMembers: LoadState<TeamMember[]>
  filters: FilterState
  onSetFilter: (key: FilterKey, value: string) => void
  onRemoveFilter: (key: FilterKey) => void
  onSaveView: () => void
}) {
  const billList = bills.status === 'ready' ? bills.data : []
  const memberList = teamMembers.status === 'ready' ? teamMembers.data : []
  const defs = useFilterDefs(billList, memberList)
  const defByKey = useMemo(
    () => new Map<FilterKey, FilterDef>(defs.map((d): [FilterKey, FilterDef] => [d.key, d])),
    [defs],
  )

  const activeKeys = defs.filter((d) => filters[d.key]).map((d) => d.key)
  const inactiveDefs = defs.filter((d) => !filters[d.key] && d.options.length > 0)

  return (
    <div className={styles.bar}>
      {activeKeys.map((key) => {
        const def = defByKey.get(key)!
        return (
          <span key={key} className={`${styles.chip} ${styles.chipActive}`}>
            <span className={styles.key}>{def.label}</span>
            <select
              className={styles.select}
              value={filters[key]}
              onChange={(e) => onSetFilter(key, e.target.value)}
              aria-label={def.label}
            >
              {def.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              className={styles.remove}
              onClick={() => onRemoveFilter(key)}
              aria-label={`Remove ${def.label} filter`}
            >
              ×
            </button>
          </span>
        )
      })}

      {inactiveDefs.length > 0 && (
        <span className={styles.addChip}>
          + Filter
          <select
            className={styles.addSelect}
            value=""
            aria-label="Add filter"
            onChange={(e) => {
              const def = defByKey.get(e.target.value as FilterKey)
              if (def && def.options[0]) onSetFilter(def.key, def.options[0].value)
            }}
          >
            <option value="" disabled />
            {inactiveDefs.map((def) => (
              <option key={def.key} value={def.key}>
                {def.label}
              </option>
            ))}
          </select>
        </span>
      )}

      <div className={styles.spacer} />
      <button className={styles.saveLink} onClick={onSaveView}>
        Save as filter
      </button>
    </div>
  )
}
