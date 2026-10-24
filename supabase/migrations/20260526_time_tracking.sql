-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: time tracking.
-- Run in Supabase SQL Editor → "RUN" once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS time_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL,
  -- NULL while the timer is running. Set when user stops, or when a manual
  -- entry is created (in which case both started_at and ended_at are set
  -- and duration_minutes is the user-supplied value).
  ended_at         TIMESTAMPTZ,
  duration_minutes INTEGER,
  notes            TEXT,
  source           TEXT NOT NULL DEFAULT 'timer' CHECK (source IN ('timer','manual')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Either still running (ended_at NULL, duration NULL) or fully stopped
  CONSTRAINT time_entry_consistency CHECK (
    (ended_at IS NULL AND duration_minutes IS NULL)
    OR (ended_at IS NOT NULL AND duration_minutes IS NOT NULL)
  )
);

-- One active timer per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_active_per_user
  ON time_entries(user_id) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id, started_at DESC);
