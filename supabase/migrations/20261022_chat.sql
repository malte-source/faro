-- =============================================================================
-- Chat interno — canales por empresa / capa / proyecto, mensajes directos,
-- hilos, menciones, reacciones y mensaje → tarea.
-- =============================================================================
--
-- Un canal pertenece a un grupo (organizations). Tipos:
--   channel  canal con nombre. Puede colgar de una empresa (workspace_id), de
--            una capa corporativa (layer) o de un proyecto (project_id).
--   dm       mensaje directo entre dos personas (dm_key = ids ordenados).
-- Acceso (se aplica en los routers, FARO usa service-role y no RLS):
--   public   cualquier miembro del grupo puede verlo y unirse.
--   private  solo sus miembros (chat_members).
-- =============================================================================

CREATE TABLE IF NOT EXISTS chat_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel', 'dm')),
  slug         TEXT,                                   -- único por grupo; null en DMs
  name         TEXT NOT NULL,
  description  TEXT,
  visibility   TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  layer        TEXT CHECK (layer IN ('gobierno', 'coe', 'sso', 'filial')),
  dm_key       TEXT,                                   -- "uuidA:uuidB" (ordenados) en DMs
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channels_slug ON chat_channels(org_id, slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channels_dm   ON chat_channels(org_id, dm_key) WHERE dm_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_channels_org ON chat_channels(org_id);

CREATE TABLE IF NOT EXISTS chat_members (
  channel_id   UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  muted        BOOLEAN NOT NULL DEFAULT false,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES users(id) ON DELETE SET NULL,   -- null = mensaje del sistema / de Faro
  kind       TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system', 'ai')),
  body       TEXT NOT NULL,
  parent_id  UUID REFERENCES chat_messages(id) ON DELETE CASCADE,  -- raíz del hilo
  mentions   UUID[] NOT NULL DEFAULT '{}',
  mention_all BOOLEAN NOT NULL DEFAULT false,                -- @todos
  task_id    UUID REFERENCES tasks(id) ON DELETE SET NULL,   -- tarea creada desde este mensaje
  edited_at  TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent  ON chat_messages(parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentions ON chat_messages USING GIN (mentions);

CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
