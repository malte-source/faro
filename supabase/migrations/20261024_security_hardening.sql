-- =============================================================================
-- Endurecimiento tras la revisión de seguridad del modo grupo (22-oct-2026)
-- =============================================================================

-- 1. Capa corporativa POR GRUPO. users.corporate_layer es global (cualquier admin
--    del workspace Personal de alguien podía escribirla), así que no puede dar
--    acceso a canales privados de otro grupo. La que otorga acceso vive aquí.
ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS corporate_layer TEXT
    CHECK (corporate_layer IN ('gobierno', 'coe', 'sso', 'filial'));

-- Backfill: donde el grupo es el "home org" de la persona, la capa ya cargada vale.
UPDATE org_memberships om
SET corporate_layer = u.corporate_layer
FROM users u
WHERE u.id = om.user_id
  AND u.org_id = om.org_id
  AND om.corporate_layer IS NULL
  AND u.corporate_layer IS NOT NULL;

-- 2. Una sola "Bandeja" por empresa (evita duplicados por carreras y que alguien
--    se adelante creando un proyecto con ese código).
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_inbox_unique
  ON projects(workspace_id) WHERE code = 'BANDEJA';
