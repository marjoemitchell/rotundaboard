import 'dotenv/config'
import { Pool, types } from 'pg'

// Every plain TIMESTAMP (without time zone) column in this schema holds a
// naive wall-clock value straight from the scraped source (bill status
// dates, vote times, hearing times) — Montana local time, not UTC; genuine
// UTC audit timestamps (users, sessions, etc.) already use TIMESTAMPTZ and
// are unaffected by this. node-postgres's default parser for this type
// (OID 1114) builds a JS Date by treating those digits as UTC, which then
// serializes with a "Z" and gets shifted to the viewer's own timezone on
// display — turning an 8am Mountain hearing into "2am" once it round-trips
// through a Mountain-time browser. Returning the raw string instead (with
// the separating space swapped for "T" so `new Date(...)` parses it, per
// spec, as a naive local time rather than misreading it some other way)
// keeps the wall-clock digits exactly as scraped, all the way to display.
types.setTypeParser(1114, (value) => value.replace(' ', 'T'))

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (copy server/.env.example to server/.env)')
}

export const pool = new Pool({ connectionString })
