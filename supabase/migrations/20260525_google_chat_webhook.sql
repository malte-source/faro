-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: Google Chat webhook per organization.
-- Run in Supabase SQL Editor → "RUN" once.
-- Safe to re-run (uses IF NOT EXISTS via DO block).
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE organizations
    ADD COLUMN google_chat_webhook_url TEXT;
EXCEPTION WHEN duplicate_column THEN
  -- already exists, no-op
  NULL;
END $$;

-- Optional: tag every audit_log entry from Chat-bot-triggered actions
-- so it doesn't pollute the activity feed of a human user.
-- The audit_source enum already includes 'chat_bot', so no change needed.
