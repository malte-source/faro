-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: sprint planning.
-- Run in Supabase SQL Editor → "RUN" once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  goal        TEXT,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  -- planned | active | completed
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed')),
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sprints_org ON sprints(org_id, status);

-- Tasks can be assigned to a sprint (nullable = backlog).
DO $$ BEGIN
  ALTER TABLE tasks ADD COLUMN sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id);
