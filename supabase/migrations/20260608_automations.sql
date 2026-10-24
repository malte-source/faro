-- Automations — if-this-then-that for projects/tasks.
-- v1 supports:
--   triggers:   'task.created', 'task.status_changed', 'task.due_soon',
--               'project.health_low'
--   conditions: { project_id?, status?, priority? }
--   actions:    set_status, set_assignee, set_priority, add_label, send_chat
--
-- The engine is in-app (src/lib/automations.ts) — this table is just the spec.
CREATE TABLE IF NOT EXISTS automations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,

  -- trigger identifier, e.g. 'task.status_changed'
  trigger     TEXT NOT NULL,

  -- ANDed conditions; JSONB so the schema can evolve without migrations.
  -- shape v1: { project_id?: uuid, status?: text, priority?: text,
  --             from_status?: text, to_status?: text }
  conditions  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ordered list of actions to run. Each item:
  --   { kind: 'set_status'|'set_assignee'|'set_priority'|'add_label'|'send_chat',
  --     value: any }
  actions     JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMPTZ,
  run_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS automations_org_trigger_idx
  ON automations(org_id, trigger)
  WHERE enabled = TRUE;

-- Run history for debugging ("why didn't my automation fire?")
CREATE TABLE IF NOT EXISTS automation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  triggered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_payload JSONB,
  matched       BOOLEAN NOT NULL,
  -- per-action outcome: [{ kind, ok, error? }]
  results       JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS automation_runs_automation_idx
  ON automation_runs(automation_id, triggered_at DESC);
