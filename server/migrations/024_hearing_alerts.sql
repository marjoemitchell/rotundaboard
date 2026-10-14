-- Hearing alerts with lead time (see src/alerts.ts and src/refreshHearings.ts).

-- The status of one bill on one meeting agenda. A bill can be removed from a
-- meeting (status 'CANCELED') while the meeting itself stays scheduled.
-- removed_at is set when an upcoming hearing is no longer in the schedule
-- that the Legislature's API returns.
ALTER TABLE committee_bill_hearings
  ADD COLUMN status TEXT,
  ADD COLUMN removed_at TIMESTAMPTZ;

-- The type of a hearing or meeting alert: 'scheduled', 'rescheduled',
-- 'canceled', or 'reminder'. NULL for other events.
ALTER TABLE change_events ADD COLUMN variant TEXT;

-- A reminder email about 24 hours before each hearing on a bill that the
-- person follows. On by default.
ALTER TABLE notification_preferences
  ADD COLUMN hearing_reminders BOOLEAN NOT NULL DEFAULT true;
