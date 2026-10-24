-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: project templates + task dependencies.
-- Run in Supabase SQL Editor → "RUN" once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- ── Project templates ─────────────────────────────────────────────────
-- A template is a reusable blueprint: name, default values for a project,
-- and a list of tasks that should be created when the template is applied.
-- Scoped per organization so each TPY-like agency has its own catalogue.

CREATE TABLE IF NOT EXISTS project_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  default_priority TEXT NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('very_high','high','medium','low','very_low')),
  default_color   TEXT NOT NULL DEFAULT '#06B6D4',
  duration_days   INTEGER, -- optional, hints the end_date when applying
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_templates_org ON project_templates(org_id);

CREATE TABLE IF NOT EXISTS project_template_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('very_high','high','medium','low','very_low')),
  -- Days offset from project start (0 = day 0). NULL = no fixed due date.
  due_offset_days INTEGER,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_template_tasks_template
  ON project_template_tasks(template_id, position);


-- ── Task dependencies ─────────────────────────────────────────────────
-- "Task A blocks task B": B cannot start until A is done.
-- Used by the Gantt to draw arrows + by AI to flag bottlenecks.

CREATE TABLE IF NOT EXISTS task_dependencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,           -- the blocked task
  depends_on_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,           -- the blocker
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A task can't depend on itself, and the pair must be unique
  CHECK (task_id <> depends_on_id),
  UNIQUE (task_id, depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on ON task_dependencies(depends_on_id);
