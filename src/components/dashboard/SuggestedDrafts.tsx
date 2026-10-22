import { forwardRef, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as client from '../../data/client'
import type { SuggestedBill, SuggestedBills } from '../../types'
import styles from './DashboardCards.module.css'

// LC drafts to track: drafts that match the subject watches, or the newest
// drafts statewide when nothing matches. The source line says which, so a
// statewide list never looks like a match. With no drafts, the section hides.
export const SuggestedDrafts = forwardRef<
  HTMLElement,
  {
    /** Tracks the bill. Rejects when tracking fails. */
    onTrack: (bill: SuggestedBill) => Promise<void>
  }
>(function SuggestedDrafts({ onTrack }, ref) {
  const [data, setData] = useState<SuggestedBills | null>(null)
  const [rows, setRows] = useState<SuggestedBill[]>([])

  useEffect(() => {
    let cancelled = false
    client
      .getSuggestedBills({ limit: 5 })
      .then((d) => {
        if (cancelled) return
        setData(d)
        setRows(d.bills)
      })
      .catch((err: unknown) => console.error(err))
    return () => {
      cancelled = true
    }
  }, [])

  if (!data || rows.length === 0) return null

  const track = async (bill: SuggestedBill) => {
    // Remove the row at once. Put it back if tracking fails.
    setRows((r) => r.filter((b) => b.id !== bill.id))
    try {
      await onTrack(bill)
    } catch {
      setRows((r) => (r.some((b) => b.id === bill.id) ? r : [bill, ...r]))
    }
  }

  return (
    <section className={styles.card} aria-label="Suggested to track" ref={ref}>
      <div className={styles.head}>
        <span className="eyebrow">Suggested to track</span>
      </div>
      <div className={styles.subhead}>
        {data.source === 'watches' ? (
          'LC drafts matching your subject watches'
        ) : data.hasWatches ? (
          'Newest LC drafts statewide. None match your subject watches yet.'
        ) : (
          <>
            Newest LC drafts statewide. <Link to="/watches">Set up subject watches</Link> to see drafts on your
            subjects.
          </>
        )}
      </div>
      {rows.map((bill) => (
        <div key={bill.id} className={styles.billRow}>
          <span className={styles.identifier}>{bill.identifier}</span>
          <div className={styles.rowMain}>
            <div className={styles.title} title={bill.title}>
              <Link to={`/bills/${bill.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {bill.title}
              </Link>
            </div>
            {bill.requester && <div className={styles.hint}>Requested by {bill.requester}</div>}
          </div>
          {bill.subject ? <span className={styles.chip}>{bill.subject}</span> : <span />}
          <button className={styles.trackButton} onClick={() => track(bill)} aria-label={`Track ${bill.identifier}`}>
            Track
          </button>
        </div>
      ))}
    </section>
  )
})
