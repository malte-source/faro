-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: file attachments on tasks + recurring task rules.
-- Run in Supabase SQL Editor → "RUN" once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- ── Task attachments ───────────────────────────────────────────────────
-- Each row is a file uploaded to the project's linked Drive folder
-- (via the existing google_drive_folder_id column) and "tagged" to a task.
-- We store the Drive file id + metadata so we can list attachments
-- without an extra Drive API round-trip per task.

CREATE TABLE IF NOT EXISTS task_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  drive_file_id   TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT,
  size_bytes      BIGINT,
  web_view_link   TEXT NOT NULL,
  icon_link       TEXT,
  uploaded_by     UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);


-- ── Recurring task rules ──────────────────────────────────────────────
-- Defines a template + cadence. A cron worker reads this table daily
-- and materializes the next task occurrence if due.
--
-- `cadence` is a tiny DSL we own (not full cron) to keep things readable:
--   daily            → every day at 00:00
--   weekly:mon       → every Monday
--   weekly:mon,fri   → Mondays AND Fridays
--   monthly:1        → 1st of each month
--   monthly:15       → 15th of each month
--   monthly:last     → last day of each month
--
-- `next_run_at` is recomputed when the rule fires. We use it as the
-- worker's pivot so the daily cron only has to scan rules where
-- next_run_at <= today.

CREATE TABLE IF NOT EXISTS task_recurring_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title_template  TEXT NOT NULL,
  description_template TEXT,
  assignee_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('very_high','high','medium','low','very_low')),
  cadence         TEXT NOT NULL, -- e.g. "weekly:mon" — see above
  next_run_at     DATE NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at     DATE,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_recurring_active ON task_recurring_rules(is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_task_recurring_project ON task_recurring_rules(project_id);
