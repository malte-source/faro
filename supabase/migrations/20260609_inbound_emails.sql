-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: Email-to-task (forward email → task automática)
--
-- Why: clientes mandan pedidos por mail, equipo internamente comparte cosas
-- por mail, gente forwardea bugs reportados. Manualmente transcribir cada
-- mail a tarea es lento. Esta feature expone un webhook por proyecto que
-- recibe emails parsed (Mailgun / Postmark / Zapier / lo-que-sea) y crea
-- la tarea automáticamente.
--
-- Modelo:
--   projects.inbound_token   — token único por proyecto. La URL es:
--                              /api/email/inbound/{token}
--   inbound_emails           — log de cada email recibido + task creada
-- ─────────────────────────────────────────────────────────────────────

-- Token único por proyecto. URL-safe ~24 chars. NULL = email-to-task desactivado.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS inbound_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_projects_inbound_token ON projects(inbound_token) WHERE inbound_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS inbound_emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Desde dónde vino (parsed del header From).
  from_email      TEXT,
  from_name       TEXT,
  subject         TEXT,
  -- Body en texto plano (HTML stripped si vino con HTML).
  body_text       TEXT,
  -- Adjuntos: array de {name, size, mime} — para v1 NO bajamos los archivos,
  -- solo guardamos los metadatos. Drive integration viene después.
  attachments     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Tarea creada si todo OK. NULL si falló o fue descartada.
  created_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  -- Razón si no se creó tarea (ej: "Subject vacío", "Token inválido").
  rejection_reason TEXT,
  -- Header completo para debug (truncado a 2KB).
  raw_headers     TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_emails_project ON inbound_emails(project_id, received_at DESC);
