import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../data/client'
import type { LegislatorSummary, LoadState } from '../types'
import { EmptyState } from '../components/shared/EmptyState'
import styles from './LegislatorsPage.module.css'

export function LegislatorsPage() {
  const [legislators, setLegislators] = useState<LoadState<LegislatorSummary[]>>({ status: 'loading' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    client
      .getLegislators()
      .then((data) => setLegislators(data.length === 0 ? { status: 'empty' } : { status: 'ready', data }))
      .catch(() => setLegislators({ status: 'empty' }))
  }, [])

  const filtered = useMemo(() => {
    if (legislators.status !== 'ready') return []
    const q = query.trim().toLowerCase()
    if (!q) return legislators.data
    return legislators.data.filter(
      (l) => l.name.toLowerCase().includes(q) || (l.district ?? '').toLowerCase().includes(q),
    )
  }, [legislators, query])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Legislators</h1>
      <p className={styles.subhead}>Every legislator we have data for, with sponsorship and voting history.</p>

      {legislators.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
      {legislators.status === 'empty' && <EmptyState message="No legislators found." />}

      {legislators.status === 'ready' && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              placeholder="Search by name or district"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.resultCount}>
              {filtered.length.toLocaleString()} of {legislators.data.length.toLocaleString()} legislators
            </div>
          </div>

          <div className={styles.table}>
            <div className={styles.grid} role="table" aria-label="Legislators">
              <div className={styles.headerRow} role="row">
                <div className={styles.headerCell} role="columnheader">
                  Name
                </div>
                <div className={styles.headerCell} role="columnheader">
                  Chamber
                </div>
                <div className={styles.headerCell} role="columnheader">
                  Party
                </div>
                <div className={styles.headerCell} role="columnheader">
                  District
                </div>
                <div className={styles.headerCell} role="columnheader">
                  Sponsored
                </div>
              </div>
              {filtered.map((l) => (
                <Link key={l.id} to={`/legislators/${l.id}`} className={styles.row} role="row">
                  <div className={styles.cell} role="cell">
                    <span className={styles.name}>{l.name}</span>
                  </div>
                  <div className={styles.cell} role="cell" style={{ textTransform: 'capitalize' }}>
                    {l.chamber ?? '—'}
                  </div>
                  <div className={styles.cell} role="cell">
                    <span
                      className={styles.partyBadge}
                      style={{ color: l.party === 'D' ? 'var(--teal)' : l.party === 'R' ? 'var(--accent, #b9723d)' : 'var(--muted)' }}
                    >
                      {l.party ?? '—'}
                    </span>
                  </div>
                  <div className={styles.cell} role="cell">
                    {l.district ?? '—'}
                  </div>
                  <div className={styles.cell} role="cell">
                    {l.sponsoredCount}
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
