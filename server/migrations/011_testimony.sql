-- Testimony: the actual written/oral statements submitted to a committee for
-- a bill's hearing, as opposed to notes.testimonyDrafts-into use case;
-- notes are an append-only log, testimony has a real lifecycle the team
-- needs to track (has this gone out yet, who's presenting it). Optionally
-- tied to a specific committee_meetings row once a hearing is scheduled —
-- nullable so testimony can be drafted before a hearing date exists yet,
-- same reasoning as notes.bill_id being nullable for hearing clips.

CREATE TABLE testimony (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  committee_meeting_id INTEGER REFERENCES committee_meetings(id),
  author_id TEXT REFERENCES team_members(id),
  position TEXT CHECK (position IN ('support', 'oppose', 'watch', 'neutral')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'delivered')),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_testimony_bill ON testimony(bill_id);
CREATE INDEX idx_testimony_status ON testimony(status);
