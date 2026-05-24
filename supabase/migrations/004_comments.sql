-- ═══════════════════════════════════════════════════════════════
-- FARO — Comentarios en tareas (Fase 1)
-- Ejecutar en Supabase SQL editor después de 003_indexes.sql
-- ═══════════════════════════════════════════════════════════════

create table if not exists task_comments (
  id          uuid primary key default uuid_generate_v4(),
  task_id     uuid not null references tasks(id) on delete cascade,
  author_id   uuid not null references users(id) on delete cascade,
  content     text not null check (char_length(content) > 0 and char_length(content) <= 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_task_comments_task
  on task_comments(task_id, created_at);

drop trigger if exists trg_task_comments_updated_at on task_comments;
create trigger trg_task_comments_updated_at before update on task_comments
  for each row execute function set_updated_at();
