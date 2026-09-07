-- Lets the team follow specific interim/administrative committees year-round,
-- independent of tracked_bills — interim committees don't map 1:1 to bills
-- (a study may spawn several bills next session, or none), so this is its
-- own primitive rather than an extension of bill tracking.

CREATE TABLE followed_committees (
  committee_id INTEGER PRIMARY KEY REFERENCES non_standing_committees(id),
  followed_by TEXT REFERENCES team_members(id),
  followed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
