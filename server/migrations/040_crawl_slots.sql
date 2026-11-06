-- The next time each host may get a request from a scraper. The hosts ask
-- for a gap between requests in their robots.txt (Crawl-delay). Several cron
-- jobs can scrape the same host at once, so they share these rows: each
-- request takes the next free time (server/src/politeFetch.ts).
CREATE TABLE crawl_slots (
  host TEXT PRIMARY KEY,
  next_at TIMESTAMPTZ NOT NULL
);
