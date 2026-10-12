-- Email alerts for tracked bills, subject watches, and followed committees
-- (see src/alerts.ts).
--
-- Changes are detected from the database rather than inside each scraper:
-- every scraped row we alert on (bill statuses, amendments, bill hearings,
-- interim-committee meetings) is upserted under the Legislature's own id,
-- so "has this change been seen?" is just "does its key exist yet?".

-- Every detected change, recorded once. `key` is a stable natural key
-- ("status:<bill_statuses.id>", "hearing:<id>:<meeting_time>", ...), so
-- re-running detection — or a scraper re-upserting the same rows — can
-- never produce the same event twice.
CREATE TABLE change_events (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('bill_status', 'amendment', 'bill_hearing', 'committee_meeting')),
  bill_id INTEGER,
  -- non_standing_committees.id, for committee_meeting events.
  committee_id INTEGER,
  summary TEXT NOT NULL,
  detail TEXT,
  -- When it happened / is scheduled for: naive Mountain wall-clock time,
  -- same convention as every other scraped TIMESTAMP (see db.ts).
  occurred_at TIMESTAMP,
  -- Recorded by the very first detection run, which snapshots existing
  -- data instead of alerting on the Legislature's entire history.
  baseline BOOLEAN NOT NULL DEFAULT false,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_change_events_bill ON change_events(bill_id);

-- One row per person per change they should hear about. The primary key is
-- what guarantees no duplicate alerts; sent_at is set when the email that
-- included it goes out (immediately, or with the next daily digest).
CREATE TABLE alert_deliveries (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES change_events(id) ON DELETE CASCADE,
  -- Why this person got it: "Tracked bill", "Watch: Property tax", ...
  reasons TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, workspace_id, event_id)
);

CREATE INDEX idx_alert_deliveries_unsent ON alert_deliveries(user_id) WHERE sent_at IS NULL;

-- Per-user delivery mode. No row = the default ('immediate').
CREATE TABLE notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery TEXT NOT NULL CHECK (delivery IN ('immediate', 'daily', 'off')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user, per-workspace opt-outs from one source of alerts: a subject
-- watch, a followed committee, or the workspace's tracked bills as a whole
-- (watch_id 0). A change still reaches someone who muted one source if
-- another unmuted one also matches it.
CREATE TABLE alert_mutes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  watch_type TEXT NOT NULL CHECK (watch_type IN ('tracked_bills', 'subject_watch', 'followed_committee')),
  watch_id INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id, watch_type, watch_id)
);
