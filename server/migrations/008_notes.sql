-- Workspace notes. bill_id is nullable: most notes are about a specific
-- tracked bill, but a hearing clip ("Clip to notes" in the audio panel)
-- often covers a committee meeting touching several bills at once, so it
-- has nowhere single to attach — those land here with bill_id null and
-- source_hearing describing where they came from instead.
CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES team_members(id),
  body TEXT NOT NULL,
  source_hearing TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_bill ON notes(bill_id);
CREATE INDEX idx_notes_created_at ON notes(created_at);
