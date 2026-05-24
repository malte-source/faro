-- ═══════════════════════════════════════════════════════════════
-- FARO — Índices críticos para rendimiento (Fase 1)
-- Ejecutar en Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════

-- users(email): usado en CADA request de tRPC para lookup de usuario
create index if not exists idx_users_email
  on users(email);

-- workspaces(org_id): usado en CADA request de tRPC para obtener workspace IDs
create index if not exists idx_workspaces_org_id
  on workspaces(org_id);

-- tasks: índices compuestos para los queries más frecuentes
-- Lista de tareas por proyecto (filtrado de subtareas con parent_task_id IS NULL)
create index if not exists idx_tasks_project_parent
  on tasks(project_id, parent_task_id);

-- Stats por estado dentro de un proyecto
create index if not exists idx_tasks_project_status
  on tasks(project_id, status);

-- Tareas por asignado + estado (para "mis tareas pendientes")
create index if not exists idx_tasks_assignee_status
  on tasks(assignee_id, status);

-- Tareas con fecha de vencimiento (calendario, notificaciones)
create index if not exists idx_tasks_due_date
  on tasks(due_date)
  where due_date is not null;

-- Proyectos: compuesto para queries de dashboard y calendario
create index if not exists idx_projects_workspace_status
  on projects(workspace_id, status);

-- Proyectos con fecha de fin (calendario, notificaciones)
create index if not exists idx_projects_end_date_status
  on projects(end_date, status)
  where end_date is not null;

-- project_members: para queries de "proyectos de un usuario"
create index if not exists idx_pm_user_project
  on project_members(user_id, project_id)
  where removed_at is null;
