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
export function DataFreshness() {
  const [freshness, setFreshness] = useState<Freshness | null>(null)

  useEffect(() => {
    client
      .getDataFreshness()
      .then(setFreshness)
      .catch(() => setFreshness(null))
  }, [])

  if (!freshness) return null

  const successes = freshness.jobs
    .map((j) => j.lastSuccessAt)
    .filter((t): t is string => t != null)
    .sort()
  const latestSuccess = freshness.lastSuccessfulScrape ?? successes[successes.length - 1] ?? null
  const ago = latestSuccess ? formatRelativeTime(latestSuccess) : null

  let text: string
  switch (freshness.status) {
    case 'unknown':
      text = 'The time of the last data update is not recorded yet.'
      break
    case 'failing':
      text = `The last data update failed. Last successful update: ${ago ?? 'none'}.`
      break
    case 'stale':
      text = `Legislature data may be out of date. Last successful update: ${ago ?? 'none'}.`
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
    </p>
  )
}
