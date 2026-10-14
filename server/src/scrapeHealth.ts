// Health checks for the scrape jobs. All bill, legislator, and committee
// data comes from bearbeta.legmt.gov, an unpublished API with no schema. If
// the API changes or stops, the data becomes old and nothing shows the
// problem. This module finds those problems and emails the maintainer.
//
// How it works:
//   1. A scrape script runs inside withScrapeMonitoring(job, ...).
//   2. legmtClient.ts reports each response with recordResponse() and each
//      failed request with recordFetchError().
//   3. When the run ends, finishRun() compares the run with the previous
//      good run of the same job and saves the result in scrape_runs.
//   4. If the problems are different from the last alert, the maintainer
//      gets one email (MAINTAINER_EMAIL). The maintainer also gets one email
//      when the problems stop.
//   5. The API server runs a watchdog every hour. It sends an alert if a job
//      has no successful run in its expected time (for example, if a cron
//      stops).
import { pool } from './db.js'
import { sendLayoutEmail } from './auth/email.js'
import { appBaseUrl, escapeHtml, type EmailContent } from './emailLayout.js'
import { ENDPOINTS, type Shape } from './legmtShapes.js'

// A count that falls below this part of the previous run is an error.
const MAX_COUNT_DROP = 0.5
// Do not compare counts that are smaller than this. Small counts change a lot.
const MIN_COUNT_TO_COMPARE = 20
// A larger part of failed requests than this is an error.
const MAX_FETCH_ERROR_RATE = 0.1

export type Severity = 'error' | 'warning'

export interface HealthProblem {
  /** A stable id, without counts, so that the same problem has the same id in each run. */
  id: string
  severity: Severity
  endpoint: string | null
  message: string
}

// ---------------------------------------------------------------- shape checks

type ProblemSink = (path: string, kind: 'missing' | 'type', detail: string) => void

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Checks one value against a shape. Reports each problem to `report`. */
export function checkShape(value: unknown, shape: Shape, path: string, report: ProblemSink): void {
  if (typeof shape === 'string') {
    const optional = shape.endsWith('?')
    const expected = optional ? shape.slice(0, -1) : shape
    if (value === undefined || value === null) {
      if (!optional && !(expected === 'any' && value === null)) {
        report(path, 'missing', `expected ${expected}, received ${typeName(value)}`)
      }
      return
    }
    if (expected !== 'any' && typeof value !== expected) {
      report(path, 'type', `expected ${expected}, received ${typeName(value)}`)
    }
    return
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) {
      report(path, value === undefined || value === null ? 'missing' : 'type', `expected array, received ${typeName(value)}`)
      return
    }
    for (const item of value) checkShape(item, shape[0], `${path}[]`, report)
    return
  }
  if ('$nullable' in shape) {
    if (value === undefined || value === null) return
    checkShape(value, shape.$nullable as Shape, path, report)
    return
  }
  if (typeName(value) !== 'object') {
    report(path, value === undefined || value === null ? 'missing' : 'type', `expected object, received ${typeName(value)}`)
    return
  }
  const obj = value as Record<string, unknown>
  for (const [field, fieldShape] of Object.entries(shape)) {
    checkShape(obj[field], fieldShape as Shape, path ? `${path}.${field}` : field, report)
  }
}

// ---------------------------------------------------------------- one run

interface EndpointStats {
  calls: number
  errors: number
  lastError: string | null
  items: number
  fields: Set<string>
  shapeProblems: Map<string, { path: string; kind: string; detail: string; count: number }>
}

class RunMonitor {
  readonly endpoints = new Map<string, EndpointStats>()

  stats(endpoint: string): EndpointStats {
    let s = this.endpoints.get(endpoint)
    if (!s) {
      s = { calls: 0, errors: 0, lastError: null, items: 0, fields: new Set(), shapeProblems: new Map() }
      this.endpoints.set(endpoint, s)
    }
    return s
  }

  response(endpoint: string, items: unknown[]): void {
    const s = this.stats(endpoint)
    s.calls += 1
    s.items += items.length
    const spec = ENDPOINTS[endpoint]
    for (const item of items) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const key of Object.keys(item)) s.fields.add(key)
      }
      if (!spec) continue
      checkShape(item, spec.item, '', (path, kind, detail) => {
        const key = `${path}|${kind}`
        const p = s.shapeProblems.get(key)
        if (p) p.count += 1
        else s.shapeProblems.set(key, { path: path || '(item)', kind, detail, count: 1 })
      })
    }
  }

  fetchError(endpoint: string, err: unknown): void {
    const s = this.stats(endpoint)
    s.calls += 1
    s.errors += 1
    s.lastError = err instanceof Error ? err.message : String(err)
  }
}

let current: RunMonitor | null = null

/** Called by legmtClient.ts for each successful response. Does nothing outside a monitored run. */
export function recordResponse(endpoint: string, items: unknown[]): void {
  current?.response(endpoint, items)
}

/** Called by legmtClient.ts for each failed request. Does nothing outside a monitored run. */
export function recordFetchError(endpoint: string, err: unknown): void {
  current?.fetchError(endpoint, err)
}

// ---------------------------------------------------------------- evaluate

interface PreviousRun {
  counts: Record<string, number>
  fingerprints: Record<string, string[]>
}

function listNames(names: string[]): string {
  return names.length > 8 ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more` : names.join(', ')
}

/** Finds the problems in a run. */
export function evaluateRun(monitor: RunMonitor, previous: PreviousRun | null, runError: string | null): HealthProblem[] {
  const problems: HealthProblem[] = []
  if (runError) {
    problems.push({ id: 'run-error', severity: 'error', endpoint: null, message: `The run stopped with an error: ${runError}` })
  }

  for (const [endpoint, s] of monitor.endpoints) {
    for (const p of s.shapeProblems.values()) {
      const what = p.kind === 'missing' ? 'is missing or null' : 'has the wrong type'
      problems.push({
        id: `shape:${endpoint}:${p.path}:${p.kind}`,
        severity: 'error',
        endpoint,
        message: `The field "${p.path}" ${what} in ${p.count.toLocaleString()} item(s) (${p.detail}).`,
      })
    }
    if (s.errors > 0 && (s.errors / s.calls > MAX_FETCH_ERROR_RATE || s.calls < 10)) {
      problems.push({
        id: `fetch:${endpoint}`,
        severity: 'error',
        endpoint,
        message: `${s.errors.toLocaleString()} of ${s.calls.toLocaleString()} requests failed. Last error: ${s.lastError}`,
      })
    }
  }

  // Count checks are not correct for a run that stopped early.
  if (runError) return problems

  const endpoints = new Set([...monitor.endpoints.keys(), ...Object.keys(previous?.counts ?? {})])
  for (const endpoint of endpoints) {
    const count = monitor.endpoints.get(endpoint)?.items ?? 0
    const before = previous?.counts[endpoint]
    if (count === 0 && (ENDPOINTS[endpoint]?.expectItems || (before ?? 0) > 0)) {
      problems.push({
        id: `empty:${endpoint}`,
        severity: 'error',
        endpoint,
        message: `The API returned no items${before ? ` (the previous run received ${before.toLocaleString()})` : ''}.`,
      })
    } else if (before != null && before >= MIN_COUNT_TO_COMPARE && count < before * MAX_COUNT_DROP) {
      problems.push({
        id: `drop:${endpoint}`,
        severity: 'error',
        endpoint,
        message: `The item count fell from ${before.toLocaleString()} to ${count.toLocaleString()}.`,
      })
    }
  }

  // Field names that appear or disappear between runs: a possible schema
  // change. A warning, because the scrapers do not use most fields.
  for (const [endpoint, s] of monitor.endpoints) {
    const before = previous?.fingerprints[endpoint]
    if (!before || before.length === 0 || s.fields.size === 0) continue
    const added = [...s.fields].filter((f) => !before.includes(f)).sort()
    const removed = before.filter((f) => !s.fields.has(f)).sort()
    if (added.length > 0) {
      problems.push({
        id: `fields-added:${endpoint}:${added.join(',')}`,
        severity: 'warning',
        endpoint,
        message: `New fields in the response: ${listNames(added)}.`,
      })
    }
    if (removed.length > 0) {
      problems.push({
        id: `fields-removed:${endpoint}:${removed.join(',')}`,
        severity: 'warning',
        endpoint,
        message: `Fields no longer in the response: ${listNames(removed)}.`,
      })
    }
  }
  return problems
}

// ---------------------------------------------------------------- alerts

/**
 * Sends the maintainer one email when the problems for `key` change, and one
 * email when the errors stop. Returns true if an email was sent.
 */
export async function alertIfChanged(
  key: string,
  title: string,
  problems: HealthProblem[],
  to: string | undefined = process.env.MAINTAINER_EMAIL,
): Promise<boolean> {
  const signature = problems.map((p) => p.id).sort().join('\n')
  const hasErrors = problems.some((p) => p.severity === 'error')
  const { rows } = await pool.query<{ signature: string; has_errors: boolean }>(
    'SELECT signature, has_errors FROM scrape_health_alerts WHERE key = $1',
    [key],
  )
  const previous = rows[0]

  // Record an alert only after the email is sent. If the send fails (no
  // MAINTAINER_EMAIL, or Resend refuses it), the next run tries again.
  if (problems.length === 0) {
    if (!previous) return false
    if (previous.has_errors) {
      const sent = await send(to, `Rotunda Board: ${title} is working again`, {
        heading: `${title[0].toUpperCase()}${title.slice(1)} is working again`,
        bodyHtml: `<p style="margin:0;">The problems with ${escapeHtml(title)} have stopped. The last check found no problems.</p>`,
        footerHtml: MAINTAINER_FOOTER,
      })
      if (!sent) return false
    }
    await pool.query('DELETE FROM scrape_health_alerts WHERE key = $1', [key])
    return previous.has_errors
  }
  if (previous?.signature === signature) return false

  const list = problems
    .map(
      (p) =>
        `<li style="margin:0 0 6px;"><b>${p.severity === 'error' ? 'Error' : 'Warning'}</b>${p.endpoint ? ` (${escapeHtml(p.endpoint)})` : ''}: ${escapeHtml(p.message)}</li>`,
    )
    .join('')
  const subject = `Rotunda Board: ${hasErrors ? 'problem' : 'warning'} with ${title}`
  const sent = await send(to, subject, {
    heading: `${hasErrors ? 'Problem' : 'Warning'}: ${title}`,
    preheader: problems[0].message.slice(0, 120),
    bodyHtml: `<p style="margin:0 0 12px;">A check found ${hasErrors ? 'a problem' : 'a change to look at'} with ${escapeHtml(title)}.</p>
<ul style="margin:0 0 12px;padding-left:20px;">${list}</ul>
<p style="margin:0;color:#5c6b80;">The data comes from bearbeta.legmt.gov, an unpublished API. A change in that API can stop the scrapers.</p>`,
    button: { label: 'Open Rotunda Board', url: appBaseUrl() },
    footerHtml: MAINTAINER_FOOTER,
  })
  if (sent) {
    await pool.query(
      `INSERT INTO scrape_health_alerts (key, signature, has_errors) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET signature = $2, has_errors = $3, alerted_at = now()`,
      [key, signature, hasErrors],
    )
  }
  return sent
}

const MAINTAINER_FOOTER =
  'You get this email because your address is MAINTAINER_EMAIL for Rotunda Board. You get one email when the problems change, and one email when the errors stop.'

async function send(to: string | undefined, subject: string, content: EmailContent): Promise<boolean> {
  if (!to) {
    console.warn(`[scrape-health] MAINTAINER_EMAIL is not set. Alert not sent: ${subject}`)
    return false
  }
  return sendLayoutEmail(to, subject, content)
}

// ---------------------------------------------------------------- run lifecycle

export interface RunResult {
  runId: number
  status: 'ok' | 'warning' | 'failed'
  problems: HealthProblem[]
  alerted: boolean
}

async function finishRun(job: string, runId: number, monitor: RunMonitor, runError: string | null, alertTo?: string): Promise<RunResult> {
  const { rows } = await pool.query<PreviousRun>(
    `SELECT counts, fingerprints FROM scrape_runs
     WHERE job = $1 AND id <> $2 AND status IN ('ok', 'warning')
     ORDER BY started_at DESC LIMIT 1`,
    [job, runId],
  )
  const problems = evaluateRun(monitor, rows[0] ?? null, runError)
  const status = problems.some((p) => p.severity === 'error') ? 'failed' : problems.length > 0 ? 'warning' : 'ok'
  const counts = Object.fromEntries([...monitor.endpoints].map(([e, s]) => [e, s.items]))
  const fingerprints = Object.fromEntries([...monitor.endpoints].map(([e, s]) => [e, [...s.fields].sort()]))
  await pool.query(
    `UPDATE scrape_runs SET finished_at = now(), status = $2, counts = $3, fingerprints = $4, problems = $5, error = $6
     WHERE id = $1`,
    [runId, status, JSON.stringify(counts), JSON.stringify(fingerprints), JSON.stringify(problems), runError],
  )
  const alerted = await alertIfChanged(job, `the "${job}" scrape`, problems, alertTo ?? process.env.MAINTAINER_EMAIL)
  return { runId, status, problems, alerted }
}

/**
 * Runs a scrape job with health checks. The job's own errors still go to
 * the caller after the run is saved, so the cron still shows a failure.
 */
export async function withScrapeMonitoring<T>(job: string, run: () => Promise<T>): Promise<T> {
  const { rows } = await pool.query<{ id: number }>('INSERT INTO scrape_runs (job) VALUES ($1) RETURNING id', [job])
  const runId = rows[0].id
  const monitor = new RunMonitor()
  current = monitor
  let result: T
  try {
    result = await run()
  } catch (err) {
    current = null
    const result = await finishRun(job, runId, monitor, err instanceof Error ? err.message : String(err))
    logResult(job, result)
    throw err
  }
  current = null
  logResult(job, await finishRun(job, runId, monitor, null))
  return result
}

function logResult(job: string, result: RunResult) {
  console.log(`scrape health (${job}): ${result.status}, ${result.problems.length} problem(s)${result.alerted ? ', alert sent' : ''}.`)
  for (const p of result.problems) console.log(`  ${p.severity}${p.endpoint ? ` [${p.endpoint}]` : ''}: ${p.message}`)
}

/**
 * For the e2e suite: a run with the given responses, without a real scrape.
 * The responses go through the same checks as a real run.
 */
export async function simulateRun(
  job: string,
  responses: { endpoint: string; items?: unknown[]; errors?: number }[],
  alertTo: string,
): Promise<RunResult> {
  const { rows } = await pool.query<{ id: number }>('INSERT INTO scrape_runs (job) VALUES ($1) RETURNING id', [job])
  const monitor = new RunMonitor()
  for (const r of responses) {
    if (r.items) monitor.response(r.endpoint, r.items)
    for (let i = 0; i < (r.errors ?? 0); i += 1) monitor.fetchError(r.endpoint, new Error('HTTP 500'))
  }
  return finishRun(job, rows[0].id, monitor, null, alertTo)
}

// ---------------------------------------------------------------- freshness + watchdog

// The scrape jobs, and how old their last successful run can be before the
// data is old. The cron schedules are in .railway/railway.ts.
export const SCRAPE_JOBS: { job: string; label: string; maxAgeHours: number }[] = [
  { job: 'scrape', label: 'Bills', maxAgeHours: 30 },
  { job: 'scrape:details', label: 'Votes and hearings', maxAgeHours: 30 },
  { job: 'refresh-meetings', label: 'Committee meetings', maxAgeHours: 8 },
  { job: 'refresh-hearings', label: 'Bill hearings', maxAgeHours: 4 },
  { job: 'refresh-bill-texts', label: 'Bill text', maxAgeHours: 8 },
]

export async function getDataFreshness() {
  const { rows } = await pool.query<{
    job: string
    last_success_at: string | null
    last_run_at: string | null
    last_run_status: string | null
  }>(
    `SELECT j.job,
            (SELECT max(finished_at) FROM scrape_runs r WHERE r.job = j.job AND r.status IN ('ok', 'warning')) AS last_success_at,
            latest.started_at AS last_run_at, latest.status AS last_run_status
     FROM unnest($1::text[]) AS j(job)
     LEFT JOIN LATERAL (
       SELECT started_at, status FROM scrape_runs r WHERE r.job = j.job AND r.status <> 'running'
       ORDER BY started_at DESC LIMIT 1
     ) latest ON true`,
    [SCRAPE_JOBS.map((j) => j.job)],
  )
  const now = Date.now()
  const jobs = SCRAPE_JOBS.map((def) => {
    const r = rows.find((row) => row.job === def.job)
    const lastSuccessAt = r?.last_success_at ? new Date(r.last_success_at).toISOString() : null
    const stale = lastSuccessAt != null && now - new Date(lastSuccessAt).getTime() > def.maxAgeHours * 3_600_000
    return {
      job: def.job,
      label: def.label,
      lastSuccessAt,
      lastRunAt: r?.last_run_at ? new Date(r.last_run_at).toISOString() : null,
      lastRunFailed: r?.last_run_status === 'failed',
      stale,
    }
  })
  const recorded = jobs.filter((j) => j.lastRunAt || j.lastSuccessAt)
  return {
    status:
      recorded.length === 0
        ? ('unknown' as const)
        : jobs.some((j) => j.lastRunFailed)
          ? ('failing' as const)
          : jobs.some((j) => j.stale)
            ? ('stale' as const)
            : ('fresh' as const),
    lastSuccessfulScrape: jobs.find((j) => j.job === 'scrape')?.lastSuccessAt ?? null,
    jobs,
  }
}

/** Sends an alert for each job that has no successful run in its expected time. */
export async function checkStaleness(to: string | undefined = process.env.MAINTAINER_EMAIL): Promise<void> {
  const freshness = await getDataFreshness()
  for (const job of freshness.jobs) {
    // A job that never ran has no history to compare with. The first run creates it.
    if (!job.lastSuccessAt && !job.lastRunAt) continue
    const def = SCRAPE_JOBS.find((d) => d.job === job.job)!
    const old = job.stale || (!job.lastSuccessAt && job.lastRunAt != null)
    const problems: HealthProblem[] = old
      ? [
          {
            id: 'stale',
            severity: 'error',
            endpoint: null,
            message: job.lastSuccessAt
              ? `The last successful run was at ${job.lastSuccessAt} (UTC). The expected time is less than ${def.maxAgeHours} hours. Look at the cron in Railway.`
              : `The job has no successful run. Look at the cron in Railway.`,
          },
        ]
      : []
    await alertIfChanged(`stale:${job.job}`, `the "${job.job}" schedule`, problems, to)
  }
}

/** Starts the hourly staleness check in the API server. */
export function startScrapeWatchdog(): void {
  const run = () =>
    checkStaleness().catch((err) => console.error('[scrape-health] staleness check failed:', err))
  setTimeout(run, 60_000).unref()
  setInterval(run, 3_600_000).unref()
}
