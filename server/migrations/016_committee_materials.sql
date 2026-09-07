-- Committee "tabs" content (Meeting Materials, Studies/Topics, Agency
-- Monitoring, Rule Review, Required Reports, Admin Materials, Past
-- Interims) — editorial HTML authored by legislative staff, served by
-- legmt.gov's public WordPress site. This is a completely separate host
-- and system from bearbeta.legmt.gov's structured committees API, and it's
-- where the real agenda PDFs/exhibit links live — a meeting can show 0
-- agendaItems in the structured API while still having a published agenda
-- here. HTML is sanitized before it's stored (see scrapeCommitteeMaterials.ts),
-- since it originates from a system we don't control.
CREATE TABLE non_standing_committee_materials (
  committee_id INTEGER NOT NULL REFERENCES non_standing_committees(id) ON DELETE CASCADE,
  tab_title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (committee_id, tab_title)
);
