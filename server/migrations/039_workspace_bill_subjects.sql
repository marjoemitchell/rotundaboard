-- The default subjects that a workspace applies to a bill. Default subjects
-- are the official subject codes from the Legislature. The Legislature also
-- applies subject codes to each draft (draft_subjects). This table holds
-- only the subjects that the workspace adds itself. Custom subjects (made by
-- the workspace) stay in tags and bill_tags.
CREATE TABLE workspace_bill_subjects (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  subject_code_id INTEGER NOT NULL REFERENCES subject_codes(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, bill_id, subject_code_id)
);

CREATE INDEX idx_workspace_bill_subjects_bill ON workspace_bill_subjects(bill_id);
