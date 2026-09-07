-- Interim committees, administrative committees, and interim budget
-- committees — everything the API calls "non-standing." These are
-- legislature-scoped (span both the session and the interim), unlike
-- standing_committees which are session-scoped.
CREATE TABLE non_standing_committees (
  id INTEGER PRIMARY KEY,
  legislature_id INTEGER REFERENCES legislatures(id),
  code TEXT,
  name TEXT,
  committee_type TEXT
);

-- legislator_id intentionally unconstrained, same reasoning as elsewhere.
CREATE TABLE non_standing_committee_memberships (
  id INTEGER PRIMARY KEY,
  committee_id INTEGER REFERENCES non_standing_committees(id) ON DELETE CASCADE,
  legislator_id INTEGER,
  role_code TEXT,
  role_name TEXT,
  start_date DATE,
  end_date DATE
);

CREATE INDEX idx_non_standing_committees_legislature ON non_standing_committees(legislature_id);
CREATE INDEX idx_non_standing_committee_memberships_committee ON non_standing_committee_memberships(committee_id);
CREATE INDEX idx_non_standing_committee_memberships_legislator ON non_standing_committee_memberships(legislator_id);
