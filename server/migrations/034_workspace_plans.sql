-- The subscription plan of each workspace. server/src/plans.ts defines what
-- each plan includes. A new workspace starts on the free plan.
ALTER TABLE workspaces
  ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'single_user', 'team', 'organization')),
  ADD COLUMN plan_changed_at TIMESTAMPTZ;

-- The workspaces that existed before plans keep all of their features.
UPDATE workspaces SET plan = 'organization', plan_changed_at = now();
