-- The priority of a tracked bill for the workspace. NULL means that the
-- workspace did not set a priority. The tracking board puts high priority
-- bills at the top of each column.
ALTER TABLE tracked_bills
  ADD COLUMN priority TEXT CHECK (priority IN ('high', 'medium', 'low'));
