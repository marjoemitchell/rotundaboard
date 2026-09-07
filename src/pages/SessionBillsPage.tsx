import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as client from '../data/client'
import type { LoadState, SessionBillSummary } from '../types'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './SessionBillsPage.module.css'

export function SessionBillsPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [bills, setBills] = useState<LoadState<SessionBillSummary[]>>({ status: 'loading' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!sessionId) return
    setBills({ status: 'loading' })
    client
      .getSessionBills(sessionId)
      .then((data) => setBills(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setBills({ status: 'empty' }))
  }, [sessionId])

  const filtered = useMemo(() => {
    if (bills.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    if (!q) return bills.data
    return bills.data.filter(
      (b) =>
        b.identifier.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q) ||
        b.sponsor.toLowerCase().includes(q),
    )
  }, [bills, query])

  return (
    <div className={styles.page}>
      <Link to="/sessions" className={styles.backLink}>
        ← Back to sessions
      </Link>
      <h1 className={styles.title}>Session bills</h1>
      <p className={styles.subhead}>Every bill on record for this session — click one to view it, or track it.</p>

      {bills.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
      {bills.status === 'empty' && <EmptyState message="No bills found for this session yet." />}

      {bills.status === 'ready' && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              placeholder="Search by bill number, title, or sponsor"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.resultCount}>
              {filtered.length.toLocaleString()} of {bills.data.length.toLocaleString()} bills
            </div>
          </div>

          <div className={styles.table}>
            <div className={styles.grid} role="table" aria-label="Session bills">
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
              {filtered.map((b) => (
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
        </>
      )}
    </div>
  )
}
