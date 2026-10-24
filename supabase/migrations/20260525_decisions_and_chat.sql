-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: Decision Matrix + AI Chat per project
-- Run in Supabase SQL Editor → "RUN" once.
-- Safe to re-run (uses IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Decision Matrix ───────────────────────────────────────────────
-- A decision is owned by a user, scoped to an org. Criteria are the rows
-- (weighted 1-10). Options are the columns. Scores are the cells (1-10).
-- Total score per option = Σ(score_for_criterion × criterion.weight).

CREATE TABLE IF NOT EXISTS decisions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | resolved | archived
  resolved_option_id UUID, -- the chosen option, set when status = resolved
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decisions_org_id ON decisions(org_id);
CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions(project_id);

CREATE TABLE IF NOT EXISTS decision_criteria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id  UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  weight       INTEGER NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 10),
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_criteria_decision_id ON decision_criteria(decision_id);

CREATE TABLE IF NOT EXISTS decision_options (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id  UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  notes        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_options_decision_id ON decision_options(decision_id);

CREATE TABLE IF NOT EXISTS decision_scores (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id  UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  criterion_id UUID NOT NULL REFERENCES decision_criteria(id) ON DELETE CASCADE,
  option_id    UUID NOT NULL REFERENCES decision_options(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL DEFAULT 5 CHECK (score BETWEEN 1 AND 10),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (criterion_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_decision_scores_decision_id ON decision_scores(decision_id);

-- Resolved option FK — added AFTER decision_options table exists.
DO $$ BEGIN
  ALTER TABLE decisions
    ADD CONSTRAINT decisions_resolved_option_fk
    FOREIGN KEY (resolved_option_id) REFERENCES decision_options(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── 2. AI Chat per project ────────────────────────────────────────────
-- One conversation per (project, user). Messages are stored verbatim
-- (role + content) so the user can revisit history later, and so we can
-- feed the last N messages back into Gemini for multi-turn context.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_project_user ON ai_conversations(project_id, user_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);
