-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: Public read-only share links.
--
-- Why: clientes y stakeholders externos quieren ver el estado de un proyecto
-- (tareas, progreso, deadlines, miembros) sin tener cuenta. Asana, Monday,
-- Notion lo ofrecen. Hoy FARO no tiene → mandás screenshots o un PDF.
--
-- Modelo:
--   share_links — token único → entity_type + entity_id. Read-only.
--   Sin RLS: el token ES la autorización (capability URL).
--
-- v1 soporta solo entity_type='project' — task/goal vienen después si hay demand.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS share_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Token: 32 chars URL-safe random. Sirve como capability — quien lo tiene puede ver.
  token           TEXT NOT NULL UNIQUE,
  -- v1: solo 'project'. Reservado para 'task'/'goal' a futuro.
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('project', 'task', 'goal')),
  entity_id       UUID NOT NULL,
  -- Label opcional para que el dueño recuerde qué es ("Status para cliente Andes").
  label           TEXT,
  -- Si está seteada, el link deja de funcionar después de esa fecha.
  expires_at      TIMESTAMPTZ,
  -- Si TRUE, los visitantes pueden dejar comentarios públicos (a futuro).
  allow_comments  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Telemetría — cuántas veces se accedió + última vez.
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_share_links_token  ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_entity ON share_links(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_share_links_org    ON share_links(org_id);
