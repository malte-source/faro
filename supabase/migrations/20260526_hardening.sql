-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: pre-production hardening.
--   1. GIN trigram indexes for ILIKE search (projects/tasks)
--   2. Audit log retention helper function
-- Run in Supabase SQL Editor → "RUN" once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- pg_trgm is the standard PostgreSQL extension for trigram-based fuzzy search.
-- Enables GIN indexes on text columns that ILIKE '%foo%' can actually USE.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_projects_name_trgm
  ON projects USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_projects_code_trgm
  ON projects USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm
  ON tasks USING gin (title gin_trgm_ops);

-- ── Audit log retention ───────────────────────────────────────────────
-- Deletes audit_log rows older than N days. Called monthly by the cron
-- handler. Returns the number of rows deleted so the cron can log it.

CREATE OR REPLACE FUNCTION cleanup_old_audit_log(days_to_keep INT DEFAULT 180)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH deleted AS (
    DELETE FROM audit_log
    WHERE changed_at < NOW() - (days_to_keep || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$;

-- Grant execute to service role (we call from cron via admin client)
GRANT EXECUTE ON FUNCTION cleanup_old_audit_log(INT) TO service_role;
