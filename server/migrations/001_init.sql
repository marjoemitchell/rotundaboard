-- Core reference data pulled from the Montana Legislature's bill-tracking API
-- (bearbeta.legmt.gov). IDs are the API's own numeric IDs, used directly as
-- primary keys so re-scraping is a plain upsert, not an identity-mapping problem.

CREATE TABLE legislatures (
  id INTEGER PRIMARY KEY,
  ordinal INTEGER NOT NULL,
  start_date DATE,
  end_date DATE
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  legislature_id INTEGER REFERENCES legislatures(id),
  ordinals TEXT NOT NULL,
  session_type TEXT NOT NULL,
  start_date DATE,
  sine_die_date TIMESTAMP,
  first_count_date TIMESTAMP,
  second_count_date TIMESTAMP
);

CREATE TABLE political_parties (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE districts (
  id INTEGER PRIMARY KEY,
  chamber TEXT,
  number INTEGER,
  name TEXT
);

CREATE TABLE legislators (
  id INTEGER PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  middle_name TEXT,
  display_name TEXT,
  chamber TEXT,
  legislature_id INTEGER REFERENCES legislatures(id),
  political_party_id INTEGER REFERENCES political_parties(id),
  district_id INTEGER REFERENCES districts(id),
  start_date DATE,
  end_date DATE,
  email_address TEXT
);

CREATE TABLE bill_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  description TEXT,
  chamber TEXT,
  sort_order INTEGER
);

CREATE TABLE progress_categories (
  id INTEGER PRIMARY KEY,
  code INTEGER,
  description TEXT,
  sort_order INTEGER
);

CREATE TABLE bill_status_codes (
  id INTEGER PRIMARY KEY,
  code TEXT,
  name TEXT,
  chamber TEXT,
  action_weight TEXT,
  progress_category_id INTEGER REFERENCES progress_categories(id)
);

CREATE TABLE subject_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  description TEXT,
  is_primary BOOLEAN
);

CREATE TABLE standing_committees (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  chamber TEXT,
  code TEXT,
  name TEXT,
  committee_type TEXT,
  default_room TEXT,
  default_day TEXT,
  default_time TEXT
);

-- legislator_id is intentionally unconstrained: committee membership and
-- legislator rosters come from separate endpoint calls, and a membership
-- referencing a legislator outside the fetched roster shouldn't abort ingest.
CREATE TABLE committee_memberships (
  id INTEGER PRIMARY KEY,
  committee_id INTEGER REFERENCES standing_committees(id),
  legislator_id INTEGER,
  role_code TEXT,
  role_name TEXT,
  start_date DATE,
  end_date DATE
);

-- A "draft" is the LC-numbered record. Most drafts never acquire a bill
-- number; the ones that do get a matching row in `bills`.
CREATE TABLE drafts (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  draft_number TEXT NOT NULL,
  drafted_at TIMESTAMP,
  short_title TEXT,
  description TEXT,
  requester_id INTEGER,
  requester_type TEXT,
  has_legal_note BOOLEAN,
  has_fiscal_note BOOLEAN,
  fiscal_analyst_id INTEGER,
  pre_intro_required BOOLEAN
);

CREATE TABLE draft_subjects (
  draft_id INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
  subject_code_id INTEGER REFERENCES subject_codes(id),
  is_primary BOOLEAN,
  PRIMARY KEY (draft_id, subject_code_id)
);

-- sponsor_id/carrier_id are intentionally unconstrained (see committee_memberships note).
CREATE TABLE bills (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  draft_id INTEGER REFERENCES drafts(id),
  bill_type_id INTEGER REFERENCES bill_types(id),
  bill_number INTEGER,
  sponsor_id INTEGER,
  carrier_id INTEGER,
  drafter_staff_member_id INTEGER,
  deadline_code_id INTEGER,
  enrolled BOOLEAN,
  version_number INTEGER,
  session_law_chapter TEXT,
  session_law_chapter_number INTEGER
);

-- The full status/action history lives under the draft in the source API
-- (it starts accumulating before a bill number ever exists).
-- standing_committee_id is intentionally unconstrained (see committee_memberships note).
CREATE TABLE bill_statuses (
  id INTEGER PRIMARY KEY,
  draft_id INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
  occurred_at TIMESTAMP NOT NULL,
  standing_committee_id INTEGER,
  bill_status_code_id INTEGER REFERENCES bill_status_codes(id),
  progress_category_id INTEGER REFERENCES progress_categories(id),
  result TEXT,
  vote JSONB,
  scheduled_bill_hearing_id INTEGER,
  executive_action_id INTEGER
);

CREATE INDEX idx_bills_session ON bills(session_id);
CREATE INDEX idx_bills_draft ON bills(draft_id);
CREATE INDEX idx_bills_type ON bills(bill_type_id);
CREATE INDEX idx_drafts_session ON drafts(session_id);
CREATE INDEX idx_bill_statuses_draft ON bill_statuses(draft_id);
CREATE INDEX idx_bill_statuses_occurred_at ON bill_statuses(occurred_at);
CREATE INDEX idx_bill_statuses_committee ON bill_statuses(standing_committee_id);
CREATE INDEX idx_committee_memberships_committee ON committee_memberships(committee_id);
CREATE INDEX idx_committee_memberships_legislator ON committee_memberships(legislator_id);
CREATE INDEX idx_standing_committees_session ON standing_committees(session_id);
CREATE INDEX idx_legislators_legislature ON legislators(legislature_id);
CREATE INDEX idx_draft_subjects_subject ON draft_subjects(subject_code_id);
