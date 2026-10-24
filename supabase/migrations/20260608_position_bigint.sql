-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: widen tasks.position INTEGER → BIGINT.
-- Run in Supabase SQL Editor → "RUN" once. Safe with existing data.
--
-- WHY: We use `Date.now()` (≈1.78e12) as the position value for new tasks
-- so newer rows naturally sort to the bottom. That number exceeds INT32
-- max (2.1e9), so every tasks.create has been failing with
--   "value … is out of range for type integer".
-- BIGINT handles up to 9.2e18 — comfortable headroom for the next ~290 years.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tasks
  ALTER COLUMN position TYPE BIGINT USING position::BIGINT;
