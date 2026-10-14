import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import * as client from '../data/client'
import type { BillComparison, BillDetail, LoadState } from '../types'
import { formatDate } from '../lib/format'
import { EmptyState } from '../components/shared/EmptyState'
import { RedlineLegend, RedlineParagraph, toParagraphs } from '../components/billText/Redline'
import styles from './BillComparePage.module.css'

// Compares two versions of a bill text: /bills/:id/compare?from=1&to=2.
export function BillComparePage() {
  const { id } = useParams<{ id: string }>()
  const [search, setSearch] = useSearchParams()
  const [bill, setBill] = useState<LoadState<BillDetail>>({ status: 'loading' })
  const [comparison, setComparison] = useState<LoadState<BillComparison>>({ status: 'loading' })
  const [onlyChanged, setOnlyChanged] = useState(true)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    client
      .getBillDetail(id)
      .then((b) => !cancelled && setBill({ status: 'ready', data: b }))
      .catch(() => !cancelled && setBill({ status: 'empty' }))
    return () => {
      cancelled = true
    }
  }, [id])

  // With no versions in the URL, compare the two newest versions.
  const versions = bill.status === 'ready' ? bill.data.textVersions : []
  const from = search.get('from') ?? versions[versions.length - 2]?.key ?? versions[0]?.key ?? null
  const to = search.get('to') ?? versions[versions.length - 1]?.key ?? null

  useEffect(() => {
    if (!id || !from || !to) return
    let cancelled = false
    setComparison({ status: 'loading' })
    client
      .compareBillVersions(id, from, to)
      .then((c) => !cancelled && setComparison({ status: 'ready', data: c }))
      .catch(() => !cancelled && setComparison({ status: 'empty' }))
    return () => {
      cancelled = true
    }
  }, [id, from, to])

  const paragraphs = useMemo(
    () => (comparison.status === 'ready' ? toParagraphs(comparison.data.parts) : []),
    [comparison],
  )
  const changedCount = paragraphs.filter((p) => p.some((piece) => piece.op !== '=')).length
  const shown = onlyChanged ? paragraphs.filter((p) => p.some((piece) => piece.op !== '=')) : paragraphs

  const choose = (which: 'from' | 'to', key: string) => {
    const next = new URLSearchParams(search)
    next.set('from', which === 'from' ? key : (from ?? key))
    next.set('to', which === 'to' ? key : (to ?? key))
    setSearch(next, { replace: true })
  }

  if (bill.status === 'loading') {
    return (
      <div className={styles.page}>
        <div className="skeleton" style={{ height: 28, width: '50%' }} />
        <div className="skeleton" style={{ height: 300, marginTop: 16 }} />
      </div>
    )
  }
  if (bill.status === 'empty') {
    return (
      <div className={styles.page}>
        <EmptyState message="This bill couldn’t be found." />
      </div>
    )
  }

  const b = bill.data
  const versionLabel = (key: string) => {
    const v = versions.find((x) => x.key === key)
    return v ? `${v.label}${v.postedAt ? ` (${formatDate(v.postedAt)})` : ''}` : key
  }

  return (
    <div className={styles.page}>
      <Link to={`/bills/${b.id}`} className={styles.back}>
        ← {b.identifier}
      </Link>
      <h1 className={styles.title}>Compare versions: {b.identifier}</h1>
      <div className={styles.subhead}>{b.title}</div>

      {versions.length < 2 ? (
        <EmptyState
          message={
            versions.length === 0
              ? 'The bill text is not available yet.'
              : 'This bill has only one version, so there is nothing to compare.'
          }
        />
      ) : (
        <>
          <div className={styles.controls}>
            <label className={styles.field}>
              <span>From</span>
              <select value={from ?? ''} onChange={(e) => choose('from', e.target.value)}>
                {versions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {versionLabel(v.key)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>To</span>
              <select value={to ?? ''} onChange={(e) => choose('to', e.target.value)}>
                {versions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {versionLabel(v.key)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.checkbox}>
              <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
              Only changed paragraphs
            </label>
          </div>

          <RedlineLegend />

          {comparison.status === 'loading' && <div className="skeleton" style={{ height: 300, marginTop: 16 }} />}
          {comparison.status === 'empty' && <EmptyState message="These versions couldn’t be compared." />}
          {comparison.status === 'ready' && (
            <section className={styles.text} aria-label="Redline">
              <div className={styles.count}>
                {changedCount === 0
                  ? 'No changes between these versions.'
                  : `${changedCount} changed ${changedCount === 1 ? 'paragraph' : 'paragraphs'}`}
              </div>
              {shown.map((pieces, i) => (
                <RedlineParagraph key={i} pieces={pieces} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
