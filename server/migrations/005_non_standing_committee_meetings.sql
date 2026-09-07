-- Interim committee meeting schedule (found via committees.legmt.gov's own
-- bundle, not bills.legmt.gov's — a separate frontend on the same API).
-- Agenda items are kept as JSONB rather than a normalized table: they're
-- display-only (title/description/order), nothing in the app queries into
-- them individually.
CREATE TABLE non_standing_committee_meetings (
  id INTEGER PRIMARY KEY,
  non_standing_committee_id INTEGER REFERENCES non_standing_committees(id),
  meeting_time TIMESTAMP,
  meeting_end_time TIMESTAMP,
  location TEXT,
  comments TEXT,
  public_participation BOOLEAN,
  status TEXT,
  agenda_items JSONB
);

CREATE INDEX idx_non_standing_committee_meetings_committee ON non_standing_committee_meetings(non_standing_committee_id);
CREATE INDEX idx_non_standing_committee_meetings_time ON non_standing_committee_meetings(meeting_time);
