-- Hearing reminders at more than one lead time (see src/alerts.ts).

-- The lead times that each person chose, in hours before the hearing.
-- An empty array turns the reminders off. The default is one reminder about
-- 24 hours before the hearing, the same as before this migration.
ALTER TABLE notification_preferences
  ADD COLUMN hearing_reminder_hours INT[] NOT NULL DEFAULT '{24}';
UPDATE notification_preferences SET hearing_reminder_hours = '{}' WHERE NOT hearing_reminders;
ALTER TABLE notification_preferences DROP COLUMN hearing_reminders;

-- The lead time of a reminder event, in hours. NULL for other events.
-- All reminders before this migration were 24 hours before the hearing.
ALTER TABLE change_events ADD COLUMN reminder_hours INT;
UPDATE change_events SET reminder_hours = 24 WHERE variant = 'reminder';
