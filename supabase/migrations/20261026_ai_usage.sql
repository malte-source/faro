-- =============================================================================
-- Medidor de IA y presupuestos
-- =============================================================================
--
-- Cada llamada a Gemini deja una fila en `ai_usage` (tokens y costo estimado en USD,
-- calculado con la tarifa vigente ese día). `ai_budgets` guarda el tope mensual por
-- grupo y por persona. Los precios de los modelos suben el 1-dic-2026 y el 1-ene-2027:
-- sin esto el gasto es una sorpresa.
--
-- El código funciona antes y después de aplicar este archivo: sin las tablas no mide
-- ni bloquea. FARO accede con la clave de servicio; RLS queda encendido sin políticas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  feature       TEXT NOT NULL,                       -- ruta tRPC o tarea de cron: tasks.parseAndCreate, cron.weekly-digest…
  model         TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'flash',       -- lite | flash | pro
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,              -- incluye tokens de razonamiento (se facturan como salida)
  cost_usd      NUMERIC(12, 6) NOT NULL DEFAULT 0,   -- estimado; la factura de Google manda
  latency_ms    INT,
  ok            BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org_time  ON ai_usage(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_user  ON ai_usage(org_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_budgets (
  org_id               UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  monthly_usd          NUMERIC(12, 2),               -- NULL = sin tope; 0 = IA apagada
  per_user_monthly_usd NUMERIC(12, 2),               -- NULL = sin tope por persona
  warn_pct             INT NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100),
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_usage   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_budgets ENABLE ROW LEVEL SECURITY;

-- Resumen agrupado por función, persona y día (zona horaria del grupo). La app suma esto
-- en lugar de traer filas sueltas: no tropieza con el corte de 1.000 filas de PostgREST.
CREATE OR REPLACE FUNCTION ai_usage_rollup(
  p_org  UUID,
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ,
  p_tz   TEXT,
  p_user UUID DEFAULT NULL
)
RETURNS TABLE (
  feature       TEXT,
  user_id       UUID,
  day           DATE,
  calls         BIGINT,
  failed        BIGINT,
  input_tokens  BIGINT,
  output_tokens BIGINT,
  cost_usd      NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    u.feature,
    u.user_id,
    (u.created_at AT TIME ZONE p_tz)::date AS day,
    count(*)                                  AS calls,
    count(*) FILTER (WHERE NOT u.ok)          AS failed,
    COALESCE(sum(u.input_tokens), 0)::bigint  AS input_tokens,
    COALESCE(sum(u.output_tokens), 0)::bigint AS output_tokens,
    COALESCE(sum(u.cost_usd), 0)              AS cost_usd
  FROM ai_usage u
  WHERE u.org_id = p_org
    AND u.created_at >= p_from
    AND u.created_at <  p_to
    AND (p_user IS NULL OR u.user_id = p_user)
  GROUP BY 1, 2, 3
$$;

REVOKE ALL ON FUNCTION ai_usage_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_usage_rollup(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO service_role;
