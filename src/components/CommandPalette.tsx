import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import * as client from '../data/client'
import type { Bill, LoadState, SearchResults } from '../types'
import { formatDate } from '../lib/format'
import type { NavId } from './LeftNav'
import styles from './CommandPalette.module.css'

export const PALETTE_PLACEHOLDER = 'Search bills, legislators, committees, and hearings…'

const DESTINATIONS: { id: NavId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'all-bills', label: 'All bills' },
  { id: 'lc-drafts', label: 'LC drafts' },
  { id: 'introduced', label: 'Introduced (HB / SB)' },
  { id: 'hearings', label: 'Hearings' },
  { id: 'legislators', label: 'Legislators' },
  { id: 'watches', label: 'Subject watches' },
  { id: 'committees', label: 'Interim committees' },
  { id: 'tracking-board', label: 'Tracking board' },
  { id: 'notes', label: 'Notes' },
  { id: 'testimony', label: 'Testimony' },
]

// The search starts after this many characters, and after a short pause in typing.
const MIN_QUERY = 2
const DEBOUNCE_MS = 150

type Option = {
  key: string
  group: 'Tracked bills' | 'Bills' | 'Legislators' | 'Interim committees' | 'Hearing recordings' | 'Pages'
  label: string
  identifier?: string
  meta?: string
  choose: () => void
}

export function CommandPalette({
  bills,
  onClose,
  onSelectBill,
  onNavigate,
  onGo,
}: {
  /** The tracked bills. With no query, the palette lists them. */
  bills: LoadState<Bill[]>
  onClose: () => void
  /** Opens a tracked bill in the drawer. */
  onSelectBill: (id: string) => void
  onNavigate: (id: NavId) => void
  /** Opens a page by its path, for example "/legislators/12". */
  onGo: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ query: string; data: SearchResults } | null>(null)
  const [failed, setFailed] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const trackedBills = bills.status === 'ready' ? bills.data : []
  const q = query.trim()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Ask the server after a pause in typing. A newer query cancels the older request.
  useEffect(() => {
    if (q.length < MIN_QUERY) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      client
        .search(q, controller.signal)
        .then((data) => {
          setResults({ query: q, data })
          setFailed(false)
        })
        .catch((err: unknown) => {
          if ((err as Error).name !== 'AbortError') setFailed(true)
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  const searching = q.length >= MIN_QUERY && results?.query !== q && !failed

  const options: Option[] = useMemo(() => {
    const lower = q.toLowerCase()
    const pages = DESTINATIONS.filter((d) => !lower || d.label.toLowerCase().includes(lower)).map(
      (d): Option => ({ key: `page:${d.id}`, group: 'Pages', label: d.label, choose: () => onNavigate(d.id) }),
    )
    if (q.length < MIN_QUERY) {
      const tracked = trackedBills
        .filter((b) => !lower || b.identifier.toLowerCase().includes(lower) || b.title.toLowerCase().includes(lower))
        .slice(0, 6)
        .map(
          (b): Option => ({
            key: `bill:${b.id}`,
            group: 'Tracked bills',
            label: b.title,
            identifier: b.identifier,
            meta: b.committee,
            choose: () => onSelectBill(b.id),
          }),
        )
      return [...tracked, ...pages]
    }
    // Keep the last results on screen while the next search runs.
    const data = results?.data
    if (!data) return pages
    return [
      ...data.bills.map(
        (b): Option => ({
          key: `bill:${b.id}`,
          group: 'Bills',
          label: b.title,
          identifier: b.identifier,
          meta: b.isTracked ? `${b.session} · tracked` : b.session,
          // A tracked bill opens in the drawer. Other bills open their page.
          choose: () => (b.isTracked ? onSelectBill(b.id) : onGo(`/bills/${b.id}`)),
        }),
      ),
      ...data.legislators.map(
        (l): Option => ({
          key: `legislator:${l.id}`,
          group: 'Legislators',
          label: l.name,
          meta: l.detail,
          choose: () => onGo(`/legislators/${l.id}`),
        }),
      ),
      ...data.committees.map(
        (c): Option => ({
          key: `committee:${c.id}`,
          group: 'Interim committees',
          label: c.name,
          choose: () => onGo(`/committees/${c.id}`),
        }),
      ),
      ...data.hearings.map(
        (h): Option => ({
          key: `hearing:${h.id}`,
          group: 'Hearing recordings',
          label: h.committee,
          meta: formatDate(h.recordedAt),
          choose: () => onGo(`/hearings/recordings/${h.id}`),
        }),
      ),
      ...pages,
    ]
  }, [q, trackedBills, results, onNavigate, onSelectBill, onGo])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, results])

  const choose = (option: Option) => {
    option.choose()
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
            placeholder={PALETTE_PLACEHOLDER}
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className={styles.hint}>ESC</span>
        </div>
        <div className={styles.list}>
          {searching && <div className={styles.status}>Searching…</div>}
          {failed && <div className={styles.status}>The search failed. Try again.</div>}
          {options.length === 0 && !searching && <div className={styles.empty}>No matches.</div>}
          {options.map((option, index) => (
            <div key={option.key}>
              {(index === 0 || options[index - 1].group !== option.group) && (
                <div className={`eyebrow ${styles.groupLabel}`}>{option.group}</div>
              )}
              <button
                className={`${styles.option} ${index === activeIndex ? styles.optionActive : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span>
                  {option.identifier && <span className={styles.optionId}>{option.identifier}</span>}
                  {option.label}
                </span>
                {option.meta && <span className={styles.optionMeta}>{option.meta}</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
