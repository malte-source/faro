-- =============================================================================
-- Multiempresa — una persona, varias empresas, un "sombrero" por empresa
-- =============================================================================
--
-- Vocabulario de UI:  Grupo = organizations · Empresa = workspaces
--                     Persona = users · Sombrero = workspace_members
--
-- Una persona tiene UN login y UNA bandeja, pero puede trabajar en N empresas
-- del grupo con un cargo distinto en cada una. El cargo vive en la membresía
-- (workspace_members.position), no en la persona.
--
-- No hay RLS: FARO accede siempre con el cliente service-role y filtra en los
-- routers tRPC (ver ctx.projectIds en src/lib/trpc/server.ts).
-- =============================================================================

-- 1. Membresías: persona ↔ empresa, con cargo y permiso por empresa.
CREATE TABLE IF NOT EXISTS workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  position      TEXT NOT NULL,                       -- cargo visible: "Administración", "Sistemas"
  role          user_role NOT NULL DEFAULT 'member', -- permiso dentro de la empresa
  is_active     BOOLEAN NOT NULL DEFAULT true,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_wm_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_ws   ON workspace_members(workspace_id);

-- 2. Áreas por empresa (antes colgaban solo del grupo).
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- 3. Proyectos compartidos: projects.workspace_id es la empresa dueña;
--    project_workspaces lista las otras empresas con las que se comparte.
CREATE TABLE IF NOT EXISTS project_workspaces (
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_pw_workspace ON project_workspaces(workspace_id);

-- 4. Tarea: en qué empresa actúa el responsable (determina el sombrero).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);

-- 5. Canal preferido de aviso por persona.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_channel TEXT NOT NULL DEFAULT 'app'
    CHECK (notify_channel IN ('app', 'email'));

-- 6. Backfill de membresías. Cada (persona, grupo) existente en org_memberships
--    entra en la primera empresa del grupo (orden alfabético). Después la
--    Dirección ajusta empresa y cargo desde la sección Personas.
INSERT INTO workspace_members (user_id, workspace_id, department_id, position, role)
SELECT
  om.user_id,
  w.id,
  CASE WHEN u.org_id = om.org_id THEN u.department_id END,
  COALESCE(NULLIF(u.position, ''), 'Miembro'),
  CASE om.role WHEN 'owner' THEN 'owner'::user_role
               WHEN 'admin' THEN 'admin'::user_role
               ELSE 'member'::user_role END
FROM org_memberships om
JOIN users u ON u.id = om.user_id
JOIN LATERAL (
  SELECT id FROM workspaces WHERE org_id = om.org_id ORDER BY name LIMIT 1
) w ON true
ON CONFLICT (user_id, workspace_id) DO NOTHING;

-- 7. Backfill de tareas: la empresa de la tarea = la empresa dueña del proyecto.
UPDATE tasks t
SET workspace_id = p.workspace_id
FROM projects p
WHERE p.id = t.project_id AND t.workspace_id IS NULL;

COMMENT ON TABLE workspace_members IS 'Sombrero: cargo y permiso de una persona dentro de una empresa del grupo.';
COMMENT ON COLUMN tasks.workspace_id IS 'Empresa en la que actúa el responsable al hacer esta tarea; define su sombrero.';
COMMENT ON COLUMN users.notify_channel IS 'Canal preferido para avisos de tareas: app | email.';

-- 8. Visibilidad por empresa (opt-in por grupo). Cuando está activa, un miembro
--    ve todos los proyectos de las empresas donde tiene sombrero (y los
--    compartidos con ellas), además de los proyectos donde es miembro explícito.
--    Apagada, el comportamiento histórico (solo project_members) no cambia.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS workspace_scoped_visibility BOOLEAN NOT NULL DEFAULT false;

UPDATE organizations SET workspace_scoped_visibility = true WHERE name = 'La Trinchera';
