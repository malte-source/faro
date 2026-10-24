-- =============================================================================
-- Org structure — capas corporativas, catálogo de roles, líneas de reporte
-- =============================================================================
--
-- Modela el framework "La Trinchera": cada persona pertenece a UNA capa
-- corporativa (Gobierno / Centro de Excelencia / Servicios Compartidos /
-- Filial), tiene un código de rol legible (DIR-01, TEC-02...), una línea de
-- reporte SÓLIDA (jerárquica, quien evalúa) y opcionalmente una línea
-- PUNTEADA (funcional, quien audita el estándar) — son dimensiones
-- independientes, tal como el documento estructural las define.
--
-- No requiere una tabla nueva: todo vive en `users` porque un rol siempre
-- pertenece a exactamente una persona activa en un momento dado, igual que
-- department_id/position ya funcionan hoy.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_code TEXT,
  ADD COLUMN IF NOT EXISTS corporate_layer TEXT
    CHECK (corporate_layer IN ('gobierno', 'coe', 'sso', 'filial')),
  ADD COLUMN IF NOT EXISTS reports_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dotted_line_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kpi_description TEXT;

CREATE INDEX IF NOT EXISTS idx_users_reports_to ON users(reports_to_user_id);
CREATE INDEX IF NOT EXISTS idx_users_dotted_line ON users(dotted_line_to_user_id);
CREATE INDEX IF NOT EXISTS idx_users_role_code ON users(org_id, role_code);

COMMENT ON COLUMN users.role_code IS 'Human-readable role ID, e.g. DIR-01, TEC-02, COM-01. Free-form per org.';
COMMENT ON COLUMN users.corporate_layer IS 'gobierno: manda. coe: fija estándar, veto de forma. sso: ejecuta por pedido. filial: opera, tiene P&L.';
COMMENT ON COLUMN users.reports_to_user_id IS 'Línea sólida — jerárquica. Quien evalúa el desempeño y fija objetivos.';
COMMENT ON COLUMN users.dotted_line_to_user_id IS 'Línea punteada — funcional. Quien da el estándar y audita cumplimiento (típicamente un CoE). NULL si no aplica.';
COMMENT ON COLUMN users.kpi_description IS 'KPI o métrica principal del rol, en texto libre (ej. "ahorro capturado vs línea base").';
