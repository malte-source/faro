-- =============================================================================
-- Preferencias de correo + registro de envíos
-- =============================================================================
--
-- Resumen diario/semanal por email (cron horario) y avisos instantáneos para lo que
-- alguien está esperando (revisiones y aprobaciones). Se envía desde Google Workspace
-- (SMTP); el código no envía nada hasta que existan SMTP_USER y SMTP_PASS.
--
-- Importante: tras aplicar esto, cada persona queda por defecto en "resumen diario a las 8".
-- Si no hay nada pendiente ese día, no se le escribe.
-- =============================================================================

ALTER TABLE user_notification_prefs
  ADD COLUMN IF NOT EXISTS email_digest TEXT NOT NULL DEFAULT 'daily'
    CHECK (email_digest IN ('off', 'daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS email_instant BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_kinds JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS digest_hour SMALLINT NOT NULL DEFAULT 8
    CHECK (digest_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS last_digest_at TIMESTAMPTZ;

COMMENT ON COLUMN user_notification_prefs.email_digest IS 'off | daily | weekly (los lunes). Hora local de la persona en digest_hour.';
COMMENT ON COLUMN user_notification_prefs.email_instant IS 'Interruptor general de avisos instantáneos por correo.';
COMMENT ON COLUMN user_notification_prefs.email_kinds IS 'Elecciones explícitas por tipo: true = siempre por correo, false = nunca. Sin clave = regla por defecto.';
COMMENT ON COLUMN user_notification_prefs.last_digest_at IS 'Último resumen enviado (o reservado por el cron). Evita doble envío el mismo día local.';

-- Una fila por correo enviado (resumen o instantáneo): tope diario de instantáneos y auditoría.
CREATE TABLE IF NOT EXISTS email_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                       -- digest_daily | digest_weekly | instant:<tipo>
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_user_day ON email_log(user_id, created_at DESC);

-- FARO accede solo con la clave de servicio: sin políticas, la clave pública no ve nada.
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
