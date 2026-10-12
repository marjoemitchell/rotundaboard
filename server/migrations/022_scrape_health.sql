-- Health checks for the scrape jobs (see src/scrapeHealth.ts). All bill,
-- legislator, and committee data comes from bearbeta.legmt.gov, an
-- unpublished API. If the API changes or stops, the data becomes old, and
-- nothing else shows the problem.

-- One row for each run of a scrape job.
CREATE TABLE scrape_runs (
  id SERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  -- 'running' until the run ends. 'warning' means the data was saved, but a
  -- check found a change to look at.
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'warning', 'failed')),
  -- Items received from each endpoint: {"bills": 4310, ...}.
  counts JSONB NOT NULL DEFAULT '{}',
  -- The field names and types seen for each endpoint, to find schema changes
  -- between runs: {"bills": ["billNumber:number", ...], ...}.
  fingerprints JSONB NOT NULL DEFAULT '{}',
  -- Problems found: [{"severity": "error", "endpoint": "bills", "message": "..."}].
  problems JSONB NOT NULL DEFAULT '[]',
  error TEXT
);

CREATE INDEX idx_scrape_runs_job ON scrape_runs(job, started_at DESC);

-- The last alert sent for each job (and for each staleness check), so that
-- the maintainer gets one email when the problems change, not one email
-- for each run.
CREATE TABLE scrape_health_alerts (
  key TEXT PRIMARY KEY,
  signature TEXT NOT NULL,
  has_errors BOOLEAN NOT NULL,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
