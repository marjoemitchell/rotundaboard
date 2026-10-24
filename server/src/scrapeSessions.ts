// Which sessions the scrapers fetch.
//
// The default is every session that has not ended (in progress or upcoming),
// plus the session that ended most recently. With this default, the data of
// a new session (its LC drafts) arrives as soon as the Legislature lists the
// session, and the last session stays current while its final actions (for
// example vetoes and chapter numbers) come in.
//
// SCRAPE_SESSION_ORDINALS overrides the default with a list of session
// ordinals, for example "20251" or "20251,20271".
import { pool } from './db.js'

export interface SessionDates {
  ordinals: string
  sineDieDate: string | null
}

/** The ordinals of SCRAPE_SESSION_ORDINALS, or null when it is not set. */
export function sessionOverride(raw: string | undefined = process.env.SCRAPE_SESSION_ORDINALS): string[] | null {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : null
}

/** The ordinals of the sessions to scrape, from all the sessions that the Legislature lists. */
export function selectSessionOrdinals(sessions: SessionDates[], now: Date = new Date()): string[] {
  const override = sessionOverride()
  if (override) return override
  const ended = (s: SessionDates) => s.sineDieDate != null && new Date(s.sineDieDate) <= now
  const open = sessions.filter((s) => !ended(s))
  const lastEnded = sessions
    .filter(ended)
    .sort((a, b) => new Date(b.sineDieDate!).getTime() - new Date(a.sineDieDate!).getTime())[0]
  const selected = [...open, ...(lastEnded ? [lastEnded] : [])].map((s) => s.ordinals)
  // Oldest first: the logs then read in the order of the sessions.
  return [...new Set(selected)].sort()
}

/** The sessions to scrape, from the sessions table (after "npm run scrape" has stored them). */
export async function sessionsToScrape(): Promise<{ id: number; ordinals: string }[]> {
  const { rows } = await pool.query<{ id: number; ordinals: string; sine_die_date: string | null }>(
    'SELECT id, ordinals, sine_die_date FROM sessions',
  )
  const wanted = new Set(
    selectSessionOrdinals(rows.map((r) => ({ ordinals: r.ordinals, sineDieDate: r.sine_die_date }))),
  )
  return rows
    .filter((r) => wanted.has(r.ordinals))
    .sort((a, b) => a.ordinals.localeCompare(b.ordinals))
    .map((r) => ({ id: r.id, ordinals: r.ordinals }))
}
