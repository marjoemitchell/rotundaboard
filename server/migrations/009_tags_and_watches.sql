-- Lets the team tag bills with their own ad-hoc subjects (the official
-- subject_codes taxonomy from bills.legmt.gov doesn't cover everything a
-- coalition cares about — e.g. "our priority list" isn't a state subject
-- code), and lets them save a named "subject watch" combining official
-- subject codes and/or their own tags. A watch is criteria, not a snapshot:
-- it's evaluated live against whichever bills currently match, so it
-- surfaces newly-introduced bills on a topic the team hasn't seen yet.

CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bill_tags (
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bill_id, tag_id)
);

CREATE INDEX idx_bill_tags_tag ON bill_tags(tag_id);

CREATE TABLE subject_watches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subject_codes TEXT[] NOT NULL DEFAULT '{}',
  tag_ids INTEGER[] NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
