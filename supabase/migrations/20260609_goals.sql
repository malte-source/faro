-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: Goals / Objectives (OKR-lite)
--
-- Why: PMs need a "para qué" layer above projects. Strategic intent —
-- "Crecer revenue 30% Q4", "Lanzar versión 2.0" — that projects roll up to.
-- The Asana killer feature, FARO had nothing equivalent.
--
-- Design:
--   - Goals are org-scoped (not per-workspace) — usually cross-cutting.
--   - Hierarchy via parent_goal_id (Q4 goal → sub-goals → projects).
--   - status: not_started | on_track | at_risk | off_track | achieved | canceled
--   - progress_pct: auto-rolled from linked projects' progress; manual override
--     allowed via the same column (UI distinguishes auto vs override).
--   - target_date: when this should be achieved by.
--   - Each project can be linked to ONE goal (projects.goal_id).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  -- Nested goal hierarchy. NULL = top-level.
  parent_goal_id  UUID REFERENCES goals(id) ON DELETE SET NULL,
  owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'canceled')),
  -- 0-100. Auto-rolled up from linked projects unless `progress_manual` is true.
  progress_pct    INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  progress_manual BOOLEAN NOT NULL DEFAULT FALSE,
  target_date     DATE,
  -- Optional quarter tag for grouping in roadmap views ("2026-Q3").
  quarter         TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goals_org ON goals(org_id);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_goal_id);
CREATE INDEX IF NOT EXISTS idx_goals_target_date ON goals(target_date) WHERE target_date IS NOT NULL;

-- Link projects to a goal. ONE goal per project (1:N goal → projects).
-- ON DELETE SET NULL means deleting a goal doesn't kill its projects.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_goal ON projects(goal_id) WHERE goal_id IS NOT NULL;
