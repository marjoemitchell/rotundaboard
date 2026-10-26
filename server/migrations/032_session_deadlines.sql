-- The deadline categories of bills and the legislative calendar of each
-- session, from bearbeta.legmt.gov. A deadline is a legislative day (for
-- example day 48). The calendar gives the date of each legislative day.

CREATE TABLE deadline_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  -- The last legislative day to send the bill to the other chamber.
  transmit_offset_day INTEGER,
  -- The last legislative day to send an amended bill back to the first chamber.
  return_offset_day INTEGER
);

CREATE TABLE legislative_calendar_days (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  calendar_day INTEGER NOT NULL,
  calendar_date DATE NOT NULL,
  UNIQUE (session_id, calendar_day)
);
