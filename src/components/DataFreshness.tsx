import { useEffect, useState } from 'react'
import * as client from '../data/client'
import type { DataFreshness as Freshness } from '../types'
import { formatRelativeTime } from '../lib/format'
import styles from './DataFreshness.module.css'

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// How recent the Legislature data is. All bill and committee data comes from
// an unpublished API. This line shows the user when that data is old.
/** "4:12 AM (16h ago)" today, "Oct 13, 4:12 AM (7d ago)" before today. */
function formatWhenWithAgo(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const when = today ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
  return `${when} (${formatRelativeTime(iso)})`
}

export function DataFreshness() {
  const [freshness, setFreshness] = useState<Freshness | null>(null)
  const [checking, setChecking] = useState(false)

  const load = () => {
    setChecking(true)
    client
      .getDataFreshness()
      .then(setFreshness)
      .catch(() => setFreshness(null))
      .finally(() => setChecking(false))
  }
  useEffect(load, [])

  if (!freshness) return null

  const successes = freshness.jobs
    .map((j) => j.lastSuccessAt)
    .filter((t): t is string => t != null)
    .sort()
  const latestSuccess = freshness.lastSuccessfulScrape ?? successes[successes.length - 1] ?? null
  const ago = latestSuccess ? formatRelativeTime(latestSuccess) : null
  const whenWithAgo = latestSuccess ? formatWhenWithAgo(latestSuccess) : 'none'

  let text: string
  switch (freshness.status) {
    case 'unknown':
      text = 'The time of the last data update is not recorded yet.'
      break
    case 'failing':
      text = `The last data update failed. Last successful update ${whenWithAgo}.`
      break
    case 'stale':
      text = `Legislature data may be out of date. Last successful update ${whenWithAgo}.`
      break
    default:
      text = `Legislature data updated ${ago}.`
  }
  const details = freshness.jobs
    .map((j) => `${j.label}: ${j.lastSuccessAt ? formatWhen(j.lastSuccessAt) : 'not recorded'}${j.lastRunFailed ? ' (last run failed)' : ''}`)
    .join('\n')
  const warn = freshness.status === 'stale' || freshness.status === 'failing'

  return (
    <p className={`${styles.line} ${warn ? styles.warn : ''}`} aria-label="Data freshness" title={details}>
      <span className={styles.dot} aria-hidden="true" />
      {text}
      {/* Check again: a run can finish while the page is open. */}
      {freshness.status === 'failing' && (
        <button className={styles.retry} onClick={load} disabled={checking}>
          {checking ? 'Checking…' : 'Retry'}
        </button>
      )}
    </p>
  )
}
