-- =============================================================================
-- Captura — audio, video, imagen o texto → propuesta de tareas → confirmar
-- =============================================================================
--
-- Una captura es lo que la persona manda (desde la app). Faro la
-- procesa con Gemini y deja `task_proposals`: una por tarea detectada, con
-- responsable, empresa, fecha y la frase literal de origen. Nada se crea como
-- tarea hasta que el usuario confirma.
--
-- Storage: bucket privado "captures", path org_id/capture_id/filename
-- (crearlo desde el panel de Supabase; límite sugerido 25 MB).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE capture_kind AS ENUM ('audio', 'video', 'image', 'text');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capture_status AS ENUM ('uploaded', 'processing', 'ready', 'confirmed', 'discarded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS captures (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES users(id),
  kind         capture_kind NOT NULL,
  source       audit_source NOT NULL DEFAULT 'app',   -- app | email
  storage_path TEXT,
  mime_type    TEXT,
  duration_sec INT,
  raw_text     TEXT,                                   -- si kind = text
  transcript   JSONB,                                  -- [{at, speaker, text}]
  status       capture_status NOT NULL DEFAULT 'uploaded',
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_captures_user ON captures(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_org  ON captures(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id      UUID NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  position        INT NOT NULL DEFAULT 0,
  title           TEXT NOT NULL,
  assignee_id     UUID REFERENCES users(id),           -- null = "sin responsable"
  workspace_id    UUID REFERENCES workspaces(id),
  project_id      UUID REFERENCES projects(id),
  due_date        DATE,
  priority        priority_level NOT NULL DEFAULT 'medium',
  quote           TEXT NOT NULL,                        -- frase literal de origen
  quote_at        TEXT,                                 -- "1:30" (audio/video) o null
  confidence      NUMERIC CHECK (confidence BETWEEN 0 AND 1),
  warning         TEXT,                                 -- sin_responsable | sin_membresia | sobrecarga
  included        BOOLEAN NOT NULL DEFAULT true,
  created_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tp_capture ON task_proposals(capture_id, position);
