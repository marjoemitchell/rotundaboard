-- What a bill summary was made from (src/generateSummaries.ts):
--   'text'      the bill text of one version (text_version_id, version_key),
--   'metadata'  the title, subject, sponsor, and status (no bill text yet).
-- The summaries before this migration are all from metadata.
ALTER TABLE bill_summaries
  ADD COLUMN source TEXT NOT NULL DEFAULT 'metadata' CHECK (source IN ('metadata', 'text')),
  ADD COLUMN text_version_id INTEGER,
  ADD COLUMN version_key TEXT,
  ADD COLUMN version_posted_at TIMESTAMPTZ;
