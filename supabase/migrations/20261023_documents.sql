-- =============================================================================
-- Documentos — repositorio de políticas, manuales, SOPs, actas, RACI, JD, SLAs
-- y acuerdos, con flujo de revisión/aprobación, versiones y generación con IA.
-- =============================================================================
--
-- Alcance: workspace_id NULL = documento de todo el grupo; con valor = de esa
-- empresa. Sin RLS: FARO usa service-role y filtra en los routers tRPC.
-- Al guardar un cambio de contenido el router guarda la versión ANTERIOR en
-- document_versions y sube documents.version.
-- =============================================================================

CREATE TABLE IF NOT EXISTS documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id   UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL DEFAULT 'otro'
                   CHECK (kind IN ('politica', 'manual', 'sop', 'acta', 'raci', 'jd', 'sla', 'acuerdo', 'otro')),
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'borrador'
                   CHECK (status IN ('borrador', 'en_revision', 'aprobado', 'obsoleto')),
  body_md        TEXT NOT NULL DEFAULT '',
  owner_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  next_review_at DATE,
  version        INT NOT NULL DEFAULT 1,
  project_id     UUID REFERENCES projects(id) ON DELETE SET NULL,
  task_id        UUID REFERENCES tasks(id) ON DELETE SET NULL,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_org       ON documents(org_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_status    ON documents(org_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_owner     ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_task      ON documents(task_id) WHERE task_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS document_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  title       TEXT NOT NULL,
  body_md     TEXT NOT NULL DEFAULT '',
  saved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id, version DESC);

COMMENT ON TABLE documents IS 'Repositorio de documentos del grupo. workspace_id NULL = todo el grupo.';
COMMENT ON COLUMN documents.version IS 'Versión actual. Las anteriores viven en document_versions.';
