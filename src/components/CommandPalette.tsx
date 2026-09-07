import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Bill, LoadState } from '../types'
import type { NavId } from './LeftNav'
import styles from './CommandPalette.module.css'

const DESTINATIONS: { id: NavId; label: string }[] = [
  { id: 'all-bills', label: 'All bills' },
  { id: 'lc-drafts', label: 'LC drafts' },
  { id: 'introduced', label: 'Introduced (HB / SB)' },
  { id: 'hearings', label: 'Hearings' },
  { id: 'legislators', label: 'Legislators' },
  { id: 'tracking-board', label: 'Tracking board' },
  { id: 'notes', label: 'Notes' },
  { id: 'testimony', label: 'Testimony' },
  { id: 'digests', label: 'Digests' },
]

type Option =
  | { kind: 'bill'; bill: Bill }
  | { kind: 'destination'; destination: (typeof DESTINATIONS)[number] }

export function CommandPalette({
  bills,
  onClose,
  onSelectBill,
  onNavigate,
}: {
  bills: LoadState<Bill[]>
  onClose: () => void
  onSelectBill: (id: string) => void
  onNavigate: (id: NavId) => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const billList = bills.status === 'ready' ? bills.data : []

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const options: Option[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matchedBills = billList
      .filter((b) => !q || b.identifier.toLowerCase().includes(q) || b.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map((bill): Option => ({ kind: 'bill', bill }))
    const matchedDestinations = DESTINATIONS.filter(
      (d) => !q || d.label.toLowerCase().includes(q),
    ).map((destination): Option => ({ kind: 'destination', destination }))
    return [...matchedBills, ...matchedDestinations]
  }, [billList, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const choose = (option: Option) => {
    if (option.kind === 'bill') onSelectBill(option.bill.id)
    else onNavigate(option.destination.id)
    onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && options[activeIndex]) {
      e.preventDefault()
      choose(options[activeIndex])
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Jump to a bill, hearing, or legislator…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className={styles.hint}>ESC</span>
        </div>
        <div className={styles.list}>
          {options.length === 0 && <div className={styles.empty}>No matches.</div>}
          {options.map((option, index) => (
            <button
              key={option.kind === 'bill' ? option.bill.id : option.destination.id}
              className={`${styles.option} ${index === activeIndex ? styles.optionActive : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              {option.kind === 'bill' ? (
                <>
                  <span>
                    <span className={styles.optionId}>{option.bill.identifier}</span>
                    {option.bill.title}
                  </span>
                  <span className={styles.optionMeta}>{option.bill.committee}</span>
                </>
              ) : (
                <span>{option.destination.label}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
