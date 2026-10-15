-- The first runs of summarize-hearings had a wrong Anthropic API key. Each
-- 401 error used one of the 3 attempts of a hearing. Give these hearings
-- their attempts again. The job now does not count such errors.
UPDATE hearing_recordings
SET ai_summary_attempts = 0, ai_summary_error = NULL
WHERE ai_summary IS NULL
  AND ai_summary_error LIKE '%authentication_error%';
