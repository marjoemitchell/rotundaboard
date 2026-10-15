-- An AI summary of each hearing transcript (src/summarizeHearings.ts).
--
-- ai_summary: { overview, topics: [{ title, summary, startSeconds }],
--   actions: [{ text, startSeconds }] }.
-- ai_summary_basis: the transcript version that the summary is for:
--   greatest(transcribed_at, speakers_identified_at). When the transcript or
--   the speaker names change, the job makes a new summary.
ALTER TABLE hearing_recordings
  ADD COLUMN ai_summary JSONB,
  ADD COLUMN ai_summary_model TEXT,
  ADD COLUMN ai_summarized_at TIMESTAMPTZ,
  ADD COLUMN ai_summary_basis TIMESTAMPTZ,
  ADD COLUMN ai_summary_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ai_summary_error TEXT;
