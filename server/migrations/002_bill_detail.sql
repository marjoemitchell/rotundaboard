-- Per-bill detail: floor votes, committee hearings/executive-action votes,
-- amendments, and cosponsors. Fetched one bill at a time from the API (no
-- session-wide bulk endpoint exists for these), so this only covers bills
-- that were actually introduced (bills.bill_number is not null) — pure LC
-- drafts never reach committee, so there's nothing to fetch for them.
--
-- legislator_id columns here are intentionally unconstrained, same reasoning
-- as 001_init.sql: these come from yet another endpoint family and a stray
-- mismatch shouldn't abort ingest. bill_status_id columns link back to the
-- status-history row a vote/action produced, also left unconstrained since
-- the API has shown at least one quirk (offset-as-page-number) and a hard FK
-- here would turn a single upstream surprise into a failed batch.

CREATE TABLE bill_votes (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  motion TEXT,
  order_of_business_id INTEGER,
  occurred_at TIMESTAMP,
  amendment_number INTEGER,
  vote_motion TEXT,
  chamber TEXT,
  sequence INTEGER,
  bill_status_id INTEGER,
  result TEXT
);

CREATE TABLE bill_vote_legislator_votes (
  id INTEGER PRIMARY KEY,
  bill_vote_id INTEGER REFERENCES bill_votes(id) ON DELETE CASCADE,
  legislator_id INTEGER,
  vote_type TEXT,
  voting_member_status TEXT
);

CREATE TABLE committee_meetings (
  id INTEGER PRIMARY KEY,
  standing_committee_id INTEGER,
  meeting_time TIMESTAMP,
  location TEXT,
  comments TEXT,
  public_participation BOOLEAN,
  bill_testimony BOOLEAN,
  status TEXT
);

CREATE TABLE committee_bill_hearings (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  committee_meeting_id INTEGER REFERENCES committee_meetings(id)
);

CREATE TABLE executive_actions (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  committee_meeting_id INTEGER REFERENCES committee_meetings(id),
  vote_time TIMESTAMP,
  motion TEXT,
  bill_status_id INTEGER
);

CREATE TABLE executive_action_legislator_votes (
  id INTEGER PRIMARY KEY,
  executive_action_id INTEGER REFERENCES executive_actions(id) ON DELETE CASCADE,
  legislator_id INTEGER,
  membership_role_code TEXT,
  committee_vote TEXT
);

CREATE TABLE amendments (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  drafter_staff_member_id INTEGER,
  bill_version INTEGER,
  number INTEGER,
  requestor_id INTEGER,
  section TEXT,
  type TEXT
);

CREATE TABLE bill_cosponsors (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  legislator_id INTEGER
);

CREATE INDEX idx_bill_votes_bill ON bill_votes(bill_id);
CREATE INDEX idx_bill_vote_legislator_votes_vote ON bill_vote_legislator_votes(bill_vote_id);
CREATE INDEX idx_bill_vote_legislator_votes_legislator ON bill_vote_legislator_votes(legislator_id);
CREATE INDEX idx_committee_bill_hearings_bill ON committee_bill_hearings(bill_id);
CREATE INDEX idx_committee_meetings_committee ON committee_meetings(standing_committee_id);
CREATE INDEX idx_committee_meetings_time ON committee_meetings(meeting_time);
CREATE INDEX idx_executive_actions_bill ON executive_actions(bill_id);
CREATE INDEX idx_executive_action_legislator_votes_action ON executive_action_legislator_votes(executive_action_id);
CREATE INDEX idx_amendments_bill ON amendments(bill_id);
CREATE INDEX idx_bill_cosponsors_bill ON bill_cosponsors(bill_id);
CREATE INDEX idx_bill_cosponsors_legislator ON bill_cosponsors(legislator_id);
