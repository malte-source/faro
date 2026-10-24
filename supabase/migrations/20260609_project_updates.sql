-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: Project status updates (newsletter-style posts).
--
-- Why: hoy el ritual "¿cómo va el proyecto?" se hace por mail / chat /
-- reunión. Sin trazabilidad. Updates les dan un canal escrito, firmado,
-- con timestamp, que además aparece en el Share link público — el
-- cliente entra y ve la historia de progreso, no solo el snapshot.
--
-- Modelo:
--   project_updates — post de un autor a un proyecto. content libre.
--                     sentiment opcional para colorear el feed.
--                     visible_in_share controla si se muestra en /share/[token].
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  -- Optional tone: positive / neutral / concern / blocker.
  -- Lets the timeline render colored borders + drives Chat webhook urgency.
  sentiment       TEXT CHECK (sentiment IN ('positive', 'neutral', 'concern', 'blocker')),
  -- If FALSE, the update is internal-only (not surfaced in public share links).
  visible_in_share BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_updates_project ON project_updates(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_updates_author  ON project_updates(author_id);
