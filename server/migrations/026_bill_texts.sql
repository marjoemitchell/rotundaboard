-- Bill text from the Legislature's document store (src/refreshBillTexts.ts).

-- One row for each version of a bill: 1 (introduced), 2, 3, ..., X (enrolled).
-- The store can have more than one copy of a version file. This table keeps
-- the newest copy. `id` is the document id in the store.
CREATE TABLE bill_text_versions (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  version_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  -- The text as paragraphs of [text, mark] runs (see src/billText.ts).
  paragraphs JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bill_id, version_key)
);

-- One row for each amendment file ("amendments in context": the bill text
-- with the amendment in it). `changes` is the difference from the bill
-- version that the amendment changes. It is null until that version text is
-- available.
CREATE TABLE amendment_documents (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amendment_id INTEGER REFERENCES amendments(id) ON DELETE SET NULL,
  base_name TEXT NOT NULL,
  bill_version INTEGER NOT NULL,
  number INTEGER NOT NULL,
  section TEXT,
  file_name TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  changes JSONB,
  summary TEXT,
  summary_model TEXT,
  summarized_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bill_id, base_name)
);
CREATE INDEX idx_amendment_documents_amendment ON amendment_documents (amendment_id);

-- When refreshBillTexts.ts last looked for new files of the bill.
ALTER TABLE bills ADD COLUMN texts_checked_at TIMESTAMPTZ;

-- The alert for a new amendment waits for the amendment summary, but not
-- longer than 12 hours after the amendment first appears (src/alerts.ts).
ALTER TABLE amendments ADD COLUMN first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
