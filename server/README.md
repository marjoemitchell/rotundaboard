# Data ingestion

All legislative data (bills, legislators, committees, votes, hearings/agendas)
comes from `bearbeta.legmt.gov`, an unpublished/beta JSON API belonging to the
Montana Legislature (see `src/legmtClient.ts`). There is no official published
schema for it — request shapes were reverse-engineered from live responses.

## Scripts

| Script | What it does | Cost |
|---|---|---|
| `npm run scrape` | Full pull: sessions, legislators, committees, bills for the target session | Slow — re-pulls every bill |
| `npm run scrape:details` | Per-bill detail pass (status history, votes, cosponsors, amendments) | Slow, concurrency-limited |
| `npm run refresh-meetings` | Interim-committee meeting times/locations/agendas only, for committees already in the DB | Fast — no bill data touched |
| `npm run generate-summaries` | AI-generated bill summaries | Only needs to run after new bills appear |

## Recommended cadence

**`refresh-meetings` should run periodically on its own** — committee agendas
get published by legislative staff a few days ahead of a meeting, often after
the meeting row itself already exists in our DB with an empty `agenda_items`
array. Without a recurring refresh, agendas silently go stale (this happened
in practice — see the interim-committee agenda gap fixed on 2026-09-06).

A systemd user timer running `refresh-meetings` every 6 hours is checked into
`systemd/` in this directory. To install it on a dev machine:

```sh
mkdir -p ~/.config/systemd/user
cp systemd/rotunda-refresh-meetings.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now rotunda-refresh-meetings.timer
```

Check status/logs with:

```sh
systemctl --user list-timers rotunda-refresh-meetings.timer
journalctl --user -u rotunda-refresh-meetings.service -n 50
```

If the machine isn't logged in continuously, run
`loginctl enable-linger $USER` once so the timer fires even without an active
session.

The full `scrape`/`scrape:details` pass is much heavier (re-pulls every bill)
and doesn't need this cadence — run it manually when a new session starts or
when bill data itself seems stale, not on a timer.
