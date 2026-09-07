-- Everything above this migration is public legislative data pulled from
-- bills.legmt.gov / committees.legmt.gov. This is different: it's the
-- coalition's own workspace data — who's on the team, which real bills
-- they're tracking, what position they've taken. None of it can be scraped;
-- it has to come from the org using the app. Seeded with a small dev dataset
-- for now (see src/seedWorkspace.ts) until there's a real auth/input flow.

CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT NOT NULL,
  email TEXT
);

CREATE TABLE tracked_bills (
  bill_id INTEGER PRIMARY KEY REFERENCES bills(id),
  position TEXT CHECK (position IN ('support', 'oppose', 'watch', 'neutral')),
  assignee_id TEXT REFERENCES team_members(id),
  tracked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activity_log (
  id SERIAL PRIMARY KEY,
  actor_id TEXT REFERENCES team_members(id),
  verb TEXT NOT NULL,
  detail TEXT NOT NULL,
  bill_id INTEGER REFERENCES bills(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tracked_bills_assignee ON tracked_bills(assignee_id);
CREATE INDEX idx_activity_log_bill ON activity_log(bill_id);
CREATE INDEX idx_activity_log_occurred_at ON activity_log(occurred_at);
