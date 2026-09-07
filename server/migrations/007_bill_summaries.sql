-- AI-generated plain-language bill summaries. Distinct from every other
-- table in this schema: not scraped (the legislature never says "what a
-- bill does" in one sentence) and not workspace input (no human wrote it).
-- Generated from bill METADATA only (title/subject/sponsor/status) — we do
-- not have actual bill text (see server/src/generateSummaries.ts) — so the
-- app must always render this next to a fact-check disclaimer, never as a
-- bare fact.
CREATE TABLE bill_summaries (
  bill_id INTEGER PRIMARY KEY REFERENCES bills(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
