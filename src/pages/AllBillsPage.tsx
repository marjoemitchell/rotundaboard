import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as client from '../data/client'
import type { LegislativeSession, LoadState, SessionBillSummary } from '../types'
import { EmptyState } from '../components/shared/EmptyState'
import { SignupGate } from '../components/shared/SignupGate'
import { usePublicView } from '../lib/publicView'
import styles from './AllBillsPage.module.css'

export type BillType = 'all' | 'lc' | 'introduced' | 'tracked'

const TYPE_TABS: { id: BillType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'lc', label: 'LC drafts' },
  { id: 'introduced', label: 'Introduced (HB / SB)' },
  { id: 'tracked', label: 'Tracked' },
]

// The page renders this many rows, then more on request. A session has more
// than 4,000 bills, and all of them at once make the page slow.
const PAGE_SIZE = 100
const SESSION_KEY = 'rotunda.allBills.session'

const isLc = (b: SessionBillSummary) => b.identifier.startsWith('LC')

// The bills of each session that this page loaded before. A click on that
// session shows them at once, and the page refreshes them in the background.
const billCache = new Map<string, SessionBillSummary[]>()

// Track and stop-tracking clicks that a response can be older than. A
// response that was requested before a click still has the old value, so
// the page applies these over it. A response requested after the last click
// has the correct values, and then the page clears them.
const trackedOverrides = new Map<string, boolean>()
let trackClicks = 0
const withOverrides = (list: SessionBillSummary[]) =>
  trackedOverrides.size === 0
    ? list
    : list.map((b) => (trackedOverrides.has(b.id) ? { ...b, isTracked: trackedOverrides.get(b.id)! } : b))

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

// The router state that SignupGate gives to Track for a visitor. After signup
// or login, the page tracks the bill.
type TrackAfterSignup = { trackBill?: { id: string; identifier: string } }

// Every bill of a session, tracked or not: /bills?session=3&type=lc&q=water.
// A visitor without an account gets the same list, with no "Tracked" tab.
export function AllBillsPage({
  onTrackBill,
  onUntrackBill,
}: {
  /** Tracks the bill. Rejects when it fails. */
  onTrackBill: (bill: { id: string; identifier: string }) => Promise<void>
  /** Stops tracking the bill. Rejects when it fails. */
  onUntrackBill: (bill: { id: string; identifier: string }) => Promise<void>
}) {
  const [search, setSearch] = useSearchParams()
  const [sessions, setSessions] = useState<LoadState<LegislativeSession[]>>({ status: 'loading' })
  const [bills, setBills] = useState<LoadState<SessionBillSummary[]>>({ status: 'loading' })
  // True when the request failed and the page has no bills to show.
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useState(PAGE_SIZE)
  const isPublic = usePublicView()
  const location = useLocation()
  const navigate = useNavigate()

  const typeTabs = isPublic ? TYPE_TABS.filter((t) => t.id !== 'tracked') : TYPE_TABS
  const requestedType = search.get('type') ?? ''
  const type = (typeTabs.some((t) => t.id === requestedType) ? requestedType : 'all') as BillType
  const query = search.get('q') ?? ''

  useEffect(() => {
    ;(isPublic ? client.getPublicSessions() : client.getSessions())
      .then((all) => {
        const newestFirst = [...all].sort((a, b) => b.ordinals.localeCompare(a.ordinals))
        setSessions(newestFirst.length === 0 ? { status: 'empty' } : { status: 'ready', data: newestFirst })
      })
      .catch(() => setSessions({ status: 'empty' }))
  }, [isPublic])

  // The session in the URL, else the last one this person chose, else the
  // newest session that has bills.
  const available = sessions.status === 'ready' ? sessions.data : []
  const requested = search.get('session') ?? readStoredSession()
  const session =
    available.find((s) => s.id === requested) ?? available.find((s) => s.billCount > 0) ?? available[0] ?? null

  const sessionId = session?.id ?? null

  // Loads the bills of a session: cached bills at once, then a refresh. A
  // click on a session tab calls this directly. The effect below only covers
  // the first load and a session change from the URL (a link, Back). A
  // dependency-driven effect alone sometimes did not run after a tab click,
  // and the list kept the bills of the session before.
  const loadedFor = useRef<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const loadSession = useCallback((id: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    loadedFor.current = id
    const toState = (data: SessionBillSummary[]): LoadState<SessionBillSummary[]> =>
      data.length === 0 ? { status: 'empty' } : { status: 'ready', data }
    const cached = billCache.get(id)
    setBills(cached ? toState(withOverrides(cached)) : { status: 'loading' })
    setFailed(false)
    const clicksAtRequest = trackClicks
    ;(isPublic ? client.getPublicSessionBills(id, controller.signal) : client.getSessionBills(id, controller.signal))
      .then((data) => {
        if (trackClicks === clicksAtRequest) trackedOverrides.clear()
        const fresh = withOverrides(data)
        billCache.set(id, fresh)
        if (loadedFor.current === id) setBills(toState(fresh))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || loadedFor.current !== id) return
        console.error(err)
        // With cached bills, keep them. Without, show the error and a retry.
        if (!cached) setFailed(true)
      })
  }, [isPublic])

  useEffect(() => {
    if (sessionId && loadedFor.current !== sessionId) loadSession(sessionId)
  }, [sessionId, loadSession])
  useEffect(() => () => controllerRef.current?.abort(), [])

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
    loadSession(id)
  }

  // Track or stop tracking from the list. The row changes at once, and goes
  // back when the request fails.
  const [pending, setPending] = useState<Set<string>>(new Set())
  const setTracked = (id: string, isTracked: boolean) => {
    trackClicks += 1
    trackedOverrides.set(id, isTracked)
    const apply = (list: SessionBillSummary[]) => list.map((b) => (b.id === id ? { ...b, isTracked } : b))
    setBills((state) => (state.status === 'ready' ? { status: 'ready', data: apply(state.data) } : state))
    for (const [key, list] of billCache) billCache.set(key, apply(list))
  }
  const toggleTracked = async (bill: SessionBillSummary) => {
    const next = !bill.isTracked
    setPending((p) => new Set(p).add(bill.id))
    setTracked(bill.id, next)
    try {
      await (next ? onTrackBill(bill) : onUntrackBill(bill))
    } catch {
      setTracked(bill.id, !next)
    } finally {
      setPending((p) => {
        const copy = new Set(p)
        copy.delete(bill.id)
        return copy
      })
    }
  }

  // A visitor who clicked Track and then signed up or logged in comes back
  // with the bill in the router state. Track that bill one time, and remove the state.
  const trackAfterSignup = (location.state as TrackAfterSignup | null)?.trackBill
  const resumed = useRef(false)
  useEffect(() => {
    if (isPublic || !trackAfterSignup || resumed.current) return
    resumed.current = true
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    setTracked(trackAfterSignup.id, true)
    onTrackBill(trackAfterSignup).catch(() => setTracked(trackAfterSignup.id, false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublic, trackAfterSignup])

  const counts = useMemo(() => {
    const list = bills.status === 'ready' ? bills.data : []
    const lc = list.filter(isLc).length
    return { all: list.length, lc, introduced: list.length - lc, tracked: list.filter((b) => b.isTracked).length }
  }, [bills])

  const filtered = useMemo(() => {
    if (bills.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    return bills.data.filter(
      (b) =>
        (type === 'all' || (type === 'tracked' ? b.isTracked : (type === 'lc') === isLc(b))) &&
        (!q ||
          b.identifier.toLowerCase().includes(q) ||
          b.title.toLowerCase().includes(q) ||
          b.sponsor.toLowerCase().includes(q)),
    )
  }, [bills, query, type])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>All bills</h1>
      <p className={styles.subhead}>
        {isPublic
          ? 'Every bill on record for the session. Click a bill to see its status, sponsors, text, and hearings.'
          : 'Every bill on record for the session. Click one to view it, or to track it.'}
      </p>

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
              {typeTabs.map((t) => (
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
              <button className={styles.retry} onClick={() => sessionId && loadSession(sessionId)}>
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

              {type === 'tracked' && filtered.length === 0 && !query && (
                <EmptyState message="Your team tracks no bills in this session. Use Track on a bill to add it." />
              )}

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
                    // The link opens the bill. The Track button is next to the
                    // link, not in it: a button in a link is not valid HTML.
                    <div key={b.id} className={styles.rowWrap} role="presentation">
                      <Link to={`/bills/${b.id}`} className={styles.row} role="row">
                        <div className={`${styles.cell} ${styles.cellId}`} role="cell">
                          <span className={styles.identifier}>{b.identifier}</span>
                        </div>
                        <div className={`${styles.cell} ${styles.cellTitle}`} role="cell">
                          <span className={styles.titleCell}>{b.title}</span>
                        </div>
                        <div className={`${styles.cell} ${styles.cellSub}`} role="cell">
                          {b.sponsor}
                          {b.party ? ` (${b.party})` : ''}
                        </div>
                        <div className={`${styles.cell} ${styles.cellSub}`} role="cell">
                          <span className={styles.statusCell} title={b.status}>
                            {b.status}
                          </span>
                        </div>
                      </Link>
                      <div className={`${styles.cell} ${styles.cellTrack}`}>
                        {isPublic ? (
                          <SignupGate
                            action="track this bill"
                            reason="It shows on your dashboard, where you can set your position on it."
                            returnState={{ trackBill: { id: b.id, identifier: b.identifier } }}
                            ariaLabel={`Track ${b.identifier}`}
                            className={styles.trackButton}
                          >
                            Track
                          </SignupGate>
                        ) : (
                          <button
                            className={`${styles.trackButton} ${b.isTracked ? styles.trackButtonOn : ''}`}
                            aria-pressed={b.isTracked}
                            aria-label={b.isTracked ? `Stop tracking ${b.identifier}` : `Track ${b.identifier}`}
                            title={b.isTracked ? 'Stop tracking' : 'Track this bill'}
                            disabled={pending.has(b.id)}
                            onClick={() => toggleTracked(b)}
                          >
                            {b.isTracked ? '✓ Tracked' : 'Track'}
                          </button>
                        )}
                      </div>
                    </div>
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
