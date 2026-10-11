-- Liveness for self-hosted workers. The WhisperX transcription job (on a GPU
-- box outside Railway) checks in here each run its GPU service is healthy;
-- the Railway transcribe-hearings cron only spends money on OpenAI as a
-- fallback when that check-in has gone stale (see --fallback-after-hours in
-- src/transcribeHearings.ts).
CREATE TABLE job_heartbeats (
  name TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail TEXT
);
