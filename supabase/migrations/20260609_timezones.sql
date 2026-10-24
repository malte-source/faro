-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: per-user + per-org timezones
--
-- Why: users in Argentina and Paraguay share UTC-3, but the SaaS will scale
-- to orgs anywhere. Each org gets a default timezone (used by cron jobs).
-- Each user can override their own (used for UI/queries — "their today").
-- Auto-detected from the browser on first call when null.
-- ─────────────────────────────────────────────────────────────────────

-- Per-org default — used by cron handlers and as fallback for users without
-- an explicit setting. NOT NULL with sensible default so legacy rows fill in.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

-- Per-user override. NULL = use the org's timezone. Auto-set from the
-- browser's `Intl.DateTimeFormat().resolvedOptions().timeZone` on first
-- authenticated request.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone TEXT;
