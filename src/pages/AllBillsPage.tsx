import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import * as client from '../data/client'
import type { LegislativeSession, LoadState, SessionBillSummary } from '../types'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './AllBillsPage.module.css'

export type BillType = 'all' | 'lc' | 'introduced'

const TYPE_TABS: { id: BillType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'lc', label: 'LC drafts' },
  { id: 'introduced', label: 'Introduced (HB / SB)' },
]

// The page renders this many rows, then more on request. A session has more
// than 4,000 bills, and all of them at once make the page slow.
const PAGE_SIZE = 100
const SESSION_KEY = 'rotunda.allBills.session'

const isLc = (b: SessionBillSummary) => b.identifier.startsWith('LC')

// The bills of each session that this page loaded before. A click on that
// session shows them at once, and the page refreshes them in the background.
const billCache = new Map<string, SessionBillSummary[]>()

/** "2025 session" from the ordinals "20251". A later session in the same year is a special session. */
export function sessionLabel(s: LegislativeSession): string {
  const year = s.ordinals.slice(0, 4)
  return s.ordinals.slice(4) === '1' ? `${year} session` : `${year} special session ${s.ordinals.slice(4)}`
}

function readStoredSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function storeSession(id: string) {
  try {
    localStorage.setItem(SESSION_KEY, id)
  } catch {
    // Storage is not available (for example, a private window). The URL keeps the session.
  }
}

// Every bill of a session, tracked or not: /bills?session=3&type=lc&q=water.
export function AllBillsPage() {
  const [search, setSearch] = useSearchParams()
  const [sessions, setSessions] = useState<LoadState<LegislativeSession[]>>({ status: 'loading' })
  const [bills, setBills] = useState<LoadState<SessionBillSummary[]>>({ status: 'loading' })
  // True when the request failed and the page has no bills to show.
  const [failed, setFailed] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [shown, setShown] = useState(PAGE_SIZE)

  const type = (['lc', 'introduced'].includes(search.get('type') ?? '') ? search.get('type') : 'all') as BillType
  const query = search.get('q') ?? ''

  useEffect(() => {
    client
      .getSessions()
      .then((all) => {
        const newestFirst = [...all].sort((a, b) => b.ordinals.localeCompare(a.ordinals))
        setSessions(newestFirst.length === 0 ? { status: 'empty' } : { status: 'ready', data: newestFirst })
      })
      .catch(() => setSessions({ status: 'empty' }))
  }, [])

  // The session in the URL, else the last one this person chose, else the
  // newest session that has bills.
  const available = sessions.status === 'ready' ? sessions.data : []
  const requested = search.get('session') ?? readStoredSession()
  const session =
    available.find((s) => s.id === requested) ?? available.find((s) => s.billCount > 0) ?? available[0] ?? null

  const sessionId = session?.id ?? null
  useEffect(() => {
    if (!sessionId) return
    // A new click cancels the request for the session before.
    const controller = new AbortController()
    const toState = (data: SessionBillSummary[]): LoadState<SessionBillSummary[]> =>
      data.length === 0 ? { status: 'empty' } : { status: 'ready', data }
    const cached = billCache.get(sessionId)
    setBills(cached ? toState(cached) : { status: 'loading' })
    setFailed(false)
    client
      .getSessionBills(sessionId, controller.signal)
      .then((data) => {
        billCache.set(sessionId, data)
        setBills(toState(data))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        console.error(err)
        // With cached bills, keep them. Without, show the error and a retry.
        if (!cached) setFailed(true)
      })
    return () => controller.abort()
  }, [sessionId, reloads])

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearch(next, { replace: true })
    setShown(PAGE_SIZE)
  }

  const chooseSession = (id: string) => {
    storeSession(id)
    update({ session: id })
    setShown(PAGE_SIZE)
  }

  const counts = useMemo(() => {
    const list = bills.status === 'ready' ? bills.data : []
    const lc = list.filter(isLc).length
    return { all: list.length, lc, introduced: list.length - lc }
  }, [bills])

  const filtered = useMemo(() => {
    if (bills.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    return bills.data.filter(
      (b) =>
        (type === 'all' || (type === 'lc') === isLc(b)) &&
        (!q ||
          b.identifier.toLowerCase().includes(q) ||
          b.title.toLowerCase().includes(q) ||
          b.sponsor.toLowerCase().includes(q)),
    )
  }, [bills, query, type])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>All bills</h1>
      <p className={styles.subhead}>Every bill on record for the session. Click one to view it, or to track it.</p>

      {sessions.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
      {sessions.status === 'empty' && <EmptyState message="No sessions yet." />}

      {session && (
        <>
          <div className={styles.switchRow}>
            <div className={styles.segmented} role="group" aria-label="Session">
              {available.map((s) => (
                <button
                  key={s.id}
                  className={`${styles.segment} ${s.id === session.id ? styles.segmentActive : ''}`}
                  aria-pressed={s.id === session.id}
                  onClick={() => chooseSession(s.id)}
                >
                  {sessionLabel(s)}
                  {s.status === 'active' ? ' (in progress)' : s.status === 'upcoming' ? ' (upcoming)' : ''}
                </button>
              ))}
            </div>
            <div className={styles.segmented} role="group" aria-label="Bill type">
              {TYPE_TABS.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.segment} ${t.id === type ? styles.segmentActive : ''}`}
                  aria-pressed={t.id === type}
                  onClick={() => update({ type: t.id === 'all' ? null : t.id })}
                >
                  {t.label}
                  {bills.status === 'ready' && <span className={styles.segmentCount}>{counts[t.id].toLocaleString()}</span>}
                </button>
              ))}
            </div>
          </div>

          {failed ? (
            <div className={styles.loadError} role="alert">
              The bills could not be loaded.{' '}
              <button className={styles.retry} onClick={() => setReloads((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {bills.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
              {bills.status === 'empty' && <EmptyState message="No bills found for this session yet." />}
            </>
          )}

          {!failed && bills.status === 'ready' && (
            <>
              <div className={styles.searchRow}>
                <input
                  className={styles.searchInput}
                  placeholder="Search by bill number, title, or sponsor"
                  value={query}
                  onChange={(e) => update({ q: e.target.value || null })}
                />
                <div className={styles.resultCount}>
                  {filtered.length.toLocaleString()} of {bills.data.length.toLocaleString()} bills
                </div>
              </div>

              <div className={styles.table}>
                <div className={styles.grid} role="table" aria-label="Bills">
                  <div className={styles.headerRow} role="row">
                    <div className={styles.headerCell} role="columnheader">
                      Bill
                    </div>
                    <div className={styles.headerCell} role="columnheader">
                      Title
                    </div>
                    <div className={styles.headerCell} role="columnheader">
                      Sponsor
                    </div>
                    <div className={styles.headerCell} role="columnheader">
                      Status
                    </div>
                    <div className={styles.headerCell} role="columnheader" />
                  </div>
                  {filtered.slice(0, shown).map((b) => (
                    <Link key={b.id} to={`/bills/${b.id}`} className={styles.row} role="row">
                      <div className={styles.cell} role="cell">
                        <span className={styles.identifier}>{b.identifier}</span>
                      </div>
                      <div className={styles.cell} role="cell">
                        <span className={styles.titleCell}>{b.title}</span>
                      </div>
                      <div className={styles.cell} role="cell">
                        {b.sponsor}
                        {b.party ? ` (${b.party})` : ''}
                      </div>
                      <div className={styles.cell} role="cell">
                        <span className={styles.statusCell} title={b.status}>
                          {b.status}
                        </span>
                      </div>
                      <div className={styles.cell} role="cell">
                        {b.isTracked && <span className={styles.trackedBadge}>Tracked</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
              {filtered.length > shown && (
                <button className={styles.showMore} onClick={() => setShown((n) => n + PAGE_SIZE * 5)}>
                  Show more ({(filtered.length - shown).toLocaleString()} not shown)
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** The old session bill list URL (/sessions/:id) opens All bills for that session. */
export function SessionBillsRedirect() {
  const { sessionId } = useParams<{ sessionId: string }>()
  return <Navigate to={sessionId ? `/bills?session=${encodeURIComponent(sessionId)}` : '/bills'} replace />
}
