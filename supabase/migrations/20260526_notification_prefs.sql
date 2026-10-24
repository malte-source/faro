-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: notification preferences per organization.
-- Run in Supabase SQL Editor → "RUN" once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- Stored as JSONB so we can add new event types without schema changes.
-- Default is "everything on" — matches the behaviour pre-migration.

DO $$ BEGIN
  ALTER TABLE organizations
    ADD COLUMN notification_prefs JSONB NOT NULL DEFAULT '{
      "chat_new_project": true,
      "chat_mentions": true,
      "chat_deadlines": true,
      "chat_weekly_digest": true,
      "chat_recurring_created": false
    }'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
