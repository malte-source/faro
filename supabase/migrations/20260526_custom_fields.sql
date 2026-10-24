-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: custom fields per project (JSONB approach).
-- Run in Supabase SQL Editor → "RUN" once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- Field DEFINITIONS live at org level: an array of { key, label, type, options? }.
-- type ∈ text | number | date | select
DO $$ BEGIN
  ALTER TABLE organizations
    ADD COLUMN custom_field_defs JSONB NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Field VALUES live per project as a { key: value } map.
DO $$ BEGIN
  ALTER TABLE projects
    ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
