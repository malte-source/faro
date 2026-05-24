-- ═══════════════════════════════════════════════════════════════
-- FARO — Schema inicial (Fase 0)
-- Multi-tenant SaaS con Row Level Security
-- ═══════════════════════════════════════════════════════════════

-- Extensiones
create extension if not exists "uuid-ossp";

-- ───────────────────────────────────────────────
-- TIPOS ENUM
-- ───────────────────────────────────────────────
create type project_status as enum (
  'not_started','in_progress','on_hold','delayed','completed','canceled','pending'
);
create type kanban_stage as enum (
  'ideas','backlog','pending','in_progress','on_hold','completed','canceled'
);
create type priority_level as enum ('very_high','high','medium','low','very_low');
create type user_role as enum ('owner','admin','manager','member','viewer','guest');
create type project_member_role as enum ('lead','contributor','viewer');
create type org_plan as enum ('free','team','business','enterprise');
create type audit_source as enum ('app','sheets','api','ai','chat_bot','email');
create type task_status as enum ('todo','in_progress','in_review','done','canceled');

-- ───────────────────────────────────────────────
-- ORGANIZATIONS (Tenants)
-- ───────────────────────────────────────────────
create table organizations (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  slug          text not null unique,
  plan          org_plan not null default 'free',
  google_workspace_domain text,
  billing_email text,
  seats_used    int not null default 1,
  seats_max     int not null default 5,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ───────────────────────────────────────────────
-- WORKSPACES
-- ───────────────────────────────────────────────
create table workspaces (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid not null references organizations(id) on delete cascade,
  name                 text not null,
  color                text not null default '#6366f1',
  icon                 text,
  default_working_days jsonb not null default '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":false,"sun":false}'
);

-- ───────────────────────────────────────────────
-- USERS
-- ───────────────────────────────────────────────
create table users (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  name          text not null,
  email         text not null unique,
  avatar_url    text,
  google_id     text unique,
  role          user_role not null default 'member',
  department_id uuid,
  position      text,
  is_active     boolean not null default true,
  joined_at     timestamptz not null default now()
);

-- ───────────────────────────────────────────────
-- DEPARTMENTS
-- ───────────────────────────────────────────────
create table departments (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  color        text not null default '#94a3b8',
  head_user_id uuid references users(id) on delete set null
);

alter table users add constraint fk_users_department
  foreign key (department_id) references departments(id) on delete set null;

-- ───────────────────────────────────────────────
-- PROJECTS
-- ───────────────────────────────────────────────
create table projects (
  id                        uuid primary key default uuid_generate_v4(),
  workspace_id              uuid not null references workspaces(id) on delete cascade,
  code                      text not null,
  name                      text not null,
  description               text,
  status                    project_status not null default 'not_started',
  kanban_stage              kanban_stage not null default 'backlog',
  priority                  priority_level not null default 'medium',
  start_date                date,
  end_date                  date,
  estimated_hours           numeric,
  progress_pct              int not null default 0 check (progress_pct between 0 and 100),
  budget                    numeric,
  currency                  text not null default 'USD',
  department_id             uuid references departments(id) on delete set null,
  color                     text not null default '#6366f1',
  icon                      text,
  google_calendar_event_id  text,
  google_drive_folder_id    text,
  notebooklm_notebook_id    text,
  health_score              int check (health_score between 0 and 100),
  health_updated_at         timestamptz,
  created_by                uuid not null references users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ───────────────────────────────────────────────
-- PROJECT MEMBERS
-- ───────────────────────────────────────────────
create table project_members (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        project_member_role not null default 'contributor',
  joined_at   timestamptz not null default now(),
  removed_at  timestamptz,
  added_by    uuid not null references users(id),
  unique (project_id, user_id)
);

-- ───────────────────────────────────────────────
-- TASKS
-- ───────────────────────────────────────────────
create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references projects(id) on delete cascade,
  title           text not null,
  description     text,
  assignee_id     uuid references users(id) on delete set null,
  reporter_id     uuid not null references users(id),
  status          task_status not null default 'todo',
  priority        priority_level not null default 'medium',
  due_date        date,
  estimated_hours numeric,
  actual_hours    numeric,
  parent_task_id  uuid references tasks(id) on delete cascade,
  position        int not null default 0,
  labels          text[] not null default '{}',
  google_task_id  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ───────────────────────────────────────────────
-- AUDIT LOG (inmutable — sin RLS de escritura para users)
-- ───────────────────────────────────────────────
create table audit_log (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  entity_type   text not null,
  entity_id     uuid not null,
  action        text not null,
  field_changed text,
  old_value     text,
  new_value     text,
  changed_by    uuid references users(id) on delete set null,
  changed_at    timestamptz not null default now(),
  source        audit_source not null default 'app',
  ip_address    inet
);

-- ───────────────────────────────────────────────
-- ALERT RULES
-- ───────────────────────────────────────────────
create table alert_rules (
  id           uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  trigger_type text not null,
  conditions   jsonb not null default '{}',
  actions      jsonb not null default '{}',
  channels     text[] not null default '{email}',
  recipients   text[] not null default '{}',
  is_active    boolean not null default true,
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now()
);

-- ───────────────────────────────────────────────
-- AI NOTEBOOKS
-- ───────────────────────────────────────────────
create table ai_notebooks (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid references projects(id) on delete cascade,
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  notebooklm_id     text,
  notebooklm_url    text,
  last_synced_at    timestamptz,
  sync_status       text not null default 'pending',
  context_type      text not null default 'project'
);

-- ───────────────────────────────────────────────
-- ÍNDICES
-- ───────────────────────────────────────────────
create index on projects(workspace_id);
create index on projects(status);
create index on projects(kanban_stage);
create index on projects(end_date);
create index on tasks(project_id);
create index on tasks(assignee_id);
create index on tasks(status);
create index on project_members(project_id);
create index on project_members(user_id);
create index on audit_log(entity_id);
create index on audit_log(org_id, changed_at desc);

-- ───────────────────────────────────────────────
-- TRIGGERS: updated_at automático
-- ───────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_projects_updated_at before update on projects
  for each row execute function set_updated_at();
create trigger trg_tasks_updated_at before update on tasks
  for each row execute function set_updated_at();
create trigger trg_orgs_updated_at before update on organizations
  for each row execute function set_updated_at();

-- ───────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ───────────────────────────────────────────────
alter table organizations  enable row level security;
alter table workspaces     enable row level security;
alter table users          enable row level security;
alter table departments    enable row level security;
alter table projects       enable row level security;
alter table project_members enable row level security;
alter table tasks          enable row level security;
alter table audit_log      enable row level security;
alter table alert_rules    enable row level security;
alter table ai_notebooks   enable row level security;

-- Función helper: org_id del usuario autenticado
create or replace function auth_user_org_id()
returns uuid language sql stable as $$
  select org_id from users where email = auth.jwt() ->> 'email' limit 1;
$$;

-- Políticas base (misma org = acceso)
create policy "org_isolation_orgs" on organizations
  using (id = auth_user_org_id());

create policy "org_isolation_workspaces" on workspaces
  using (org_id = auth_user_org_id());

create policy "org_isolation_users" on users
  using (org_id = auth_user_org_id());

create policy "org_isolation_departments" on departments
  using (org_id = auth_user_org_id());

create policy "org_isolation_projects" on projects
  using (workspace_id in (select id from workspaces where org_id = auth_user_org_id()));

create policy "org_isolation_project_members" on project_members
  using (project_id in (
    select p.id from projects p
    join workspaces w on w.id = p.workspace_id
    where w.org_id = auth_user_org_id()
  ));

create policy "org_isolation_tasks" on tasks
  using (project_id in (
    select p.id from projects p
    join workspaces w on w.id = p.workspace_id
    where w.org_id = auth_user_org_id()
  ));

create policy "org_isolation_audit_log" on audit_log
  using (org_id = auth_user_org_id());

create policy "org_isolation_alert_rules" on alert_rules
  using (workspace_id in (select id from workspaces where org_id = auth_user_org_id()));

create policy "org_isolation_ai_notebooks" on ai_notebooks
  using (workspace_id in (select id from workspaces where org_id = auth_user_org_id()));
