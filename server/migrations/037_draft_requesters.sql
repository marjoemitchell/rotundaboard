-- An LC draft has a requester, not a sponsor. drafts.requester_type tells
-- which table has the requester: legislators, standing_committees,
-- non_standing_committees, or organizations (agencies and other groups).
CREATE TABLE organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT
);

-- Some drafts are also requested "by request of" another person or group,
-- for example a legislator by request of an agency.
CREATE TABLE draft_by_request_ofs (
  id INTEGER PRIMARY KEY,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  request_of_id INTEGER NOT NULL
);

CREATE INDEX draft_by_request_ofs_draft_id ON draft_by_request_ofs (draft_id);
