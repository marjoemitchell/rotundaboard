-- The alert detection (src/alerts.ts) asks "was this hearing or meeting
-- announced before, at any time?" The key contains the meeting time
-- ("meeting:123:2027-01-14 08:00:00"), so that question needs the key
-- without the time. `ref` is that part ("meeting:123"), with an index, so
-- each check is an index lookup, not a scan of all events.
ALTER TABLE change_events
  ADD COLUMN ref TEXT GENERATED ALWAYS AS (split_part(key, ':', 1) || ':' || split_part(key, ':', 2)) STORED;
CREATE INDEX idx_change_events_ref ON change_events (ref);
