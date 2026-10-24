-- =============================================================================
-- Avisos reales: bandeja persistida + suscripciones Web Push + preferencias
-- =============================================================================
--
-- Hasta hoy los avisos eran solo "derivados" (tareas vencidas o por vencer, calculadas
-- al vuelo). Esto agrega avisos que ocurren por un evento (te asignaron una tarea, te
-- mencionaron, te piden revisar un documento…) y que se quedan hasta que los leas.
-- FARO accede con la clave de servicio: no hay políticas RLS (ver supabase/README.md).
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                    -- task_assigned, mention, dm, doc_review…
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,                             -- a dónde lleva al tocarlo
  entity_type TEXT,                             -- task | document | chat | cost_run…
  entity_id   UUID,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread  ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,            -- una suscripción por dispositivo/navegador
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled  BOOLEAN NOT NULL DEFAULT true,
  kinds         JSONB NOT NULL DEFAULT '{}',    -- { "mention": false, … } sobrescribe el valor por defecto de cada tipo
  quiet_start   TIME,                           -- horas de silencio (hora local de la persona)
  quiet_end     TIME,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sin esto, un grupo/usuario borrado dejaría suscripciones huérfanas; el CASCADE ya lo cubre.
