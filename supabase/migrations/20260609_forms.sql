-- ─────────────────────────────────────────────────────────────────────
-- FARO migration: Intake Forms (públicos sin auth → crean tareas)
--
-- Why: clientes externos piden cosas a TPY (un cambio en la web, un pedido,
-- un bug) y hoy lo hacen por WhatsApp / email / Slack. Cada pedido tiene
-- que ser transcripto manualmente a una tarea. Esta tabla habilita un
-- form público con un slug único que crea la tarea automáticamente.
--
-- Modelo:
--   intake_forms       — definición del form (campos, proyecto destino).
--   intake_submissions — cada submission con su raw data y task creada (si todo OK).
--
-- Rate limiting está en el endpoint /api/forms/[slug]/submit (no en DB).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intake_forms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- URL slug — único por instance (no per-org porque la URL pública lo necesita).
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  description         TEXT,
  -- Nombre opcional de la organización pidiendo cosas — "Andes Solutions",
  -- usado para personalizar el header del form público.
  branding_name       TEXT,
  -- Proyecto donde caen las tareas creadas. NOT NULL — sin proyecto no hay form.
  target_project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Opcional: vincular las tareas creadas con un goal.
  target_goal_id      UUID REFERENCES goals(id) ON DELETE SET NULL,
  -- Default priority para tareas creadas (puede sobrescribirse con un campo del form).
  default_priority    TEXT NOT NULL DEFAULT 'medium'
                        CHECK (default_priority IN ('very_high','high','medium','low','very_low')),
  -- Definición de campos. Array de objetos:
  --   { id, label, type: 'text'|'textarea'|'email'|'select'|'date'|'phone',
  --     required: boolean, placeholder?, options?: string[],
  --     target: 'title'|'description'|'due_date'|'metadata'|'priority' }
  fields              JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Mensaje mostrado tras submit exitoso.
  success_message     TEXT NOT NULL DEFAULT 'Recibimos tu pedido. Lo procesaremos a la brevedad.',
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  submission_count    INTEGER NOT NULL DEFAULT 0,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_forms_org      ON intake_forms(org_id);
CREATE INDEX IF NOT EXISTS idx_intake_forms_active   ON intake_forms(slug) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_intake_forms_project  ON intake_forms(target_project_id);

CREATE TABLE IF NOT EXISTS intake_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         UUID NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
  -- Datos crudos del form — todo lo que envió el usuario, en JSON.
  raw_data        JSONB NOT NULL,
  -- Tarea creada si la submission fue exitosa. NULL si falló o se descartó.
  created_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  -- Para rate limiting + audit. Hashed for privacy.
  submitter_ip    TEXT,
  user_agent      TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_subs_form     ON intake_submissions(form_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_subs_recent   ON intake_submissions(submitted_at DESC);
