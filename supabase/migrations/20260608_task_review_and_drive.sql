-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: task-level Drive link + document review tracking.
-- Run in Supabase SQL Editor → RUN. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- C2 — Drive link per task (the brief / spec / supporting doc).
-- Generic URL field, not necessarily Drive — accepts any link.
DO $$ BEGIN
  ALTER TABLE tasks ADD COLUMN drive_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- C3 — Document review tracking.
-- `reviewer_id` = who must approve when the task moves to in_review.
-- `review_state` = pending | requested | approved | changes_requested | null.
--   - null: task hasn't entered the review loop
--   - 'requested': assignee marked "ready for review", waiting for reviewer
--   - 'approved': reviewer signed off (task usually moves to done)
--   - 'changes_requested': reviewer wants changes (task goes back to in_progress)
DO $$ BEGIN
  ALTER TABLE tasks ADD COLUMN reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tasks ADD COLUMN review_state TEXT
    CHECK (review_state IN ('requested', 'approved', 'changes_requested'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_reviewer ON tasks(reviewer_id) WHERE reviewer_id IS NOT NULL;
