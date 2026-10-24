-- =============================================================================
-- Costos intercompany — modelo de costeo del holding (plan estructural §7)
-- =============================================================================
--
--   Capa        Año 1                                   Método
--   Gobierno    prorrateo por facturación de la filial  revenue
--   CoE         presupuesto central                     central   (no se reparte)
--   SSO         prorrateo por headcount                 headcount
--   Ventas SSO  base fija + variable sobre venta        base_plus_variable
--
-- cost_pools          lo que cuesta cada servicio/capa por mes
-- empresa_period_metrics  datos del mes por empresa (facturación, headcount, ventas atribuidas)
-- charge_runs / charge_lines  corrida mensual de cargos: borrador → aprobado (otra persona) → anulado
--
-- Sin RLS: FARO usa service-role y filtra en los routers (solo Dirección).
-- =============================================================================

CREATE TABLE IF NOT EXISTS cost_pools (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  layer          TEXT NOT NULL CHECK (layer IN ('gobierno', 'coe', 'sso')),
  method         TEXT NOT NULL CHECK (method IN ('revenue', 'headcount', 'central', 'base_plus_variable')),
  monthly_amount NUMERIC NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  currency       TEXT NOT NULL DEFAULT 'PYG',
  variable_pct   NUMERIC NOT NULL DEFAULT 0 CHECK (variable_pct >= 0 AND variable_pct <= 100),
  notes          TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_pools_org ON cost_pools(org_id);

CREATE TABLE IF NOT EXISTS empresa_period_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period          TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  revenue         NUMERIC NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  headcount       INT NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  attributed_sales NUMERIC NOT NULL DEFAULT 0 CHECK (attributed_sales >= 0),
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, period)
);

CREATE INDEX IF NOT EXISTS idx_epm_org_period ON empresa_period_metrics(org_id, period);

CREATE TABLE IF NOT EXISTS charge_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period      TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status      TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'aprobado', 'anulado')),
  prepared_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  note        TEXT,
  total       NUMERIC,                                  -- null cuando hay más de una moneda
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una corrida vigente (borrador o aprobada) por mes y grupo; las anuladas no cuentan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_runs_active ON charge_runs(org_id, period) WHERE status <> 'anulado';

CREATE TABLE IF NOT EXISTS charge_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES charge_runs(id) ON DELETE CASCADE,
  pool_id      UUID REFERENCES cost_pools(id) ON DELETE SET NULL,
  pool_name    TEXT NOT NULL,
  method       TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  amount       NUMERIC NOT NULL DEFAULT 0,
  driver_value NUMERIC NOT NULL DEFAULT 0,
  driver_share NUMERIC NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'PYG',
  explanation  TEXT
);

CREATE INDEX IF NOT EXISTS idx_charge_lines_run ON charge_lines(run_id);
