-- Archived, dated recaps — unlike the dashboard's Morning Brief (getBrief),
-- which is always "right now" and never persisted, a digest is a snapshot
-- generated on demand and kept around so the team can look back at what
-- went out on a given date, or copy it out to send to people who aren't in
-- the tool day-to-day (board members, coalition partners). No email
-- delivery yet — this is the generate-and-archive step; sending is a later
-- phase once the content itself proves useful.
--
-- highlights/sections are JSONB, same reasoning as committee meeting
-- agenda_items: display-only content, nothing queries into them
-- individually, so a normalized child table would just add indirection.
--   highlights: [{ billId, identifier, title, detail }] — momentum movers,
--     each linkable back to its bill.
--   sections:   [{ title, items: string[] }] — team activity, upcoming
--     hearings, testimony status, subject watches; plain text, no linking.

CREATE TABLE digests (
  id SERIAL PRIMARY KEY,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  summary TEXT NOT NULL,
  highlights JSONB NOT NULL DEFAULT '[]',
  sections JSONB NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_digests_created_at ON digests(created_at);
