-- ═══════════════════════════════════════════════════════════════
-- FARO — Schema inicial (Fase 0)  — IDEMPOTENTE (puede correr N veces)
-- ═══════════════════════════════════════════════════════════════

-- Extensiones
create extension if not exists "uuid-ossp";

-- ───────────────────────────────────────────────
-- TIPOS ENUM  (DO/EXCEPTION para idempotencia)
-- ───────────────────────────────────────────────
do $$ begin
  create type project_status as enum (
    'not_started','in_progress','on_hold','delayed','completed','canceled','pending'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type kanban_stage as enum (
    'ideas','backlog','pending','in_progress','on_hold','completed','canceled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority_level as enum ('very_high','high','medium','low','very_low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('owner','admin','manager','member','viewer','guest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_member_role as enum ('lead','contributor','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type org_plan as enum ('free','team','business','enterprise');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_source as enum ('app','sheets','api','ai','chat_bot','email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('todo','in_progress','in_review','done','canceled');
exception when duplicate_object then null; end $$;

-- ───────────────────────────────────────────────
-- ORGANIZATIONS
-- ───────────────────────────────────────────────
create table if not exists organizations (
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
create table if not exists workspaces (
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
create table if not exists users (
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
create table if not exists departments (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  color        text not null default '#94a3b8',
  head_user_id uuid references users(id) on delete set null
);

do $$ begin
  alter table users add constraint fk_users_department
    foreign key (department_id) references departments(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ───────────────────────────────────────────────
-- PROJECTS
-- ───────────────────────────────────────────────
create table if not exists projects (
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
create table if not exists project_members (
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
create table if not exists tasks (
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
-- AUDIT LOG
-- ───────────────────────────────────────────────
create table if not exists audit_log (
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
create table if not exists alert_rules (
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
create table if not exists ai_notebooks (
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
create index if not exists idx_projects_workspace  on projects(workspace_id);
create index if not exists idx_projects_status     on projects(status);
create index if not exists idx_projects_kanban     on projects(kanban_stage);
create index if not exists idx_projects_end_date   on projects(end_date);
create index if not exists idx_tasks_project       on tasks(project_id);
create index if not exists idx_tasks_assignee      on tasks(assignee_id);
create index if not exists idx_tasks_status        on tasks(status);
create index if not exists idx_pm_project          on project_members(project_id);
create index if not exists idx_pm_user             on project_members(user_id);
create index if not exists idx_audit_entity        on audit_log(entity_id);
create index if not exists idx_audit_org_date      on audit_log(org_id, changed_at desc);

-- ───────────────────────────────────────────────
-- TRIGGERS: updated_at automático
-- ───────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at before update on projects
  for each row execute function set_updated_at();

drop trigger if exists trg_tasks_updated_at on tasks;
create trigger trg_tasks_updated_at before update on tasks
  for each row execute function set_updated_at();

drop trigger if exists trg_orgs_updated_at on organizations;
create trigger trg_orgs_updated_at before update on organizations
  for each row execute function set_updated_at();

-- ───────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ───────────────────────────────────────────────
alter table organizations   enable row level security;
alter table workspaces      enable row level security;
alter table users           enable row level security;
alter table departments     enable row level security;
alter table projects        enable row level security;
alter table project_members enable row level security;
alter table tasks           enable row level security;
alter table audit_log       enable row level security;
alter table alert_rules     enable row level security;
alter table ai_notebooks    enable row level security;

-- Función helper: org_id del usuario autenticado
create or replace function auth_user_org_id()
returns uuid language sql stable security definer as $$
  select org_id from users where email = auth.jwt() ->> 'email' limit 1;
$$;

-- Políticas (drop first para idempotencia)
drop policy if exists "org_isolation_orgs"            on organizations;
drop policy if exists "org_isolation_workspaces"      on workspaces;
drop policy if exists "org_isolation_users"           on users;
drop policy if exists "org_isolation_departments"     on departments;
drop policy if exists "org_isolation_projects"        on projects;
drop policy if exists "org_isolation_project_members" on project_members;
drop policy if exists "org_isolation_tasks"           on tasks;
drop policy if exists "org_isolation_audit_log"       on audit_log;
drop policy if exists "org_isolation_alert_rules"     on alert_rules;
drop policy if exists "org_isolation_ai_notebooks"    on ai_notebooks;

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
