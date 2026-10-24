-- =============================================================================
-- Búsqueda híbrida (texto + significado) con permisos
-- =============================================================================
--
-- Un solo índice (`search_documents`) con tareas, documentos, mensajes de chat,
-- decisiones y avances de proyecto. Cada fila lleva:
--   • `tsv`       texto completo en español, SIN tildes (se busca "decision" y aparece "decisión")
--   • `embedding` vector de 768 dimensiones de `gemini-embedding-2` (significado)
-- y `search_hybrid()` fusiona ambos rankings con Reciprocal Rank Fusion (RRF, k = 60).
--
-- PERMISOS: FARO no usa RLS para decidir quién ve qué; lo decide el servidor. El
-- servidor calcula, por persona, tres listas (proyectos, canales, empresas visibles) y
-- se las pasa a la función, que las aplica DENTRO de la consulta:
--   fila con project_id  → el proyecto debe estar en p_project_ids        (tareas, avances)
--   fila con channel_id  → el canal debe estar en p_channel_ids           (chat)
--   el resto             → sin empresa (todo el grupo) o empresa en p_workspace_ids
--                          (documentos; las decisiones son del grupo, como en su router)
--
-- Las tablas llevan RLS sin políticas y los permisos revocados a la clave pública: solo
-- la clave de servicio (el servidor) las toca.
--
-- Idempotente. El código funciona antes y después de aplicarla (sin ella, la búsqueda
-- cae al modo básico por título y el cron de indexado responde "not_ready").
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- unaccent() no es IMMUTABLE y una columna generada lo exige: este envoltorio lo es en la práctica
-- (el diccionario no cambia entre llamadas) y es el patrón estándar para índices sin tildes.
CREATE OR REPLACE FUNCTION faro_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public, extensions
AS $$ SELECT unaccent($1) $$;

CREATE TABLE IF NOT EXISTS search_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('task', 'document', 'chat', 'decision', 'update')),
  entity_id         UUID NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,
  channel_id        UUID REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  url               TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  tsv               TSVECTOR GENERATED ALWAYS AS (
                      setweight(to_tsvector('spanish', faro_unaccent(coalesce(title, ''))), 'A') ||
                      setweight(to_tsvector('spanish', faro_unaccent(coalesce(body, ''))), 'B')
                    ) STORED,
  embedding         vector(768),
  embedded_at       TIMESTAMPTZ,
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_search_documents_tsv       ON search_documents USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_search_documents_embedding ON search_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_search_documents_org_type  ON search_documents (org_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_search_documents_backlog   ON search_documents (source_updated_at) WHERE embedded_at IS NULL;

-- Dónde se quedó el indexador en cada fuente ("stream"): cursor por (fecha, id), sin saltarse filas.
CREATE TABLE IF NOT EXISTS search_index_state (
  stream     TEXT PRIMARY KEY,
  cursor     TIMESTAMPTZ,
  cursor_id  UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON search_documents, search_index_state FROM anon, authenticated;

-- ── Búsqueda híbrida ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION search_hybrid(
  p_org           UUID,
  p_query         TEXT,
  p_embedding     vector(768),
  p_project_ids   UUID[],
  p_channel_ids   UUID[],
  p_workspace_ids UUID[],
  p_types         TEXT[],
  p_limit         INT DEFAULT 20
)
RETURNS TABLE (
  entity_type       TEXT,
  entity_id         UUID,
  title             TEXT,
  body              TEXT,
  project_id        UUID,
  channel_id        UUID,
  workspace_id      UUID,
  author_id         UUID,
  url               TEXT,
  source_updated_at TIMESTAMPTZ,
  score             DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH scoped AS (
    SELECT d.id, d.tsv, d.embedding
    FROM search_documents d
    WHERE d.org_id = p_org
      AND (p_types IS NULL OR cardinality(p_types) = 0 OR d.entity_type = ANY (p_types))
      AND (
        (d.project_id IS NOT NULL AND d.project_id = ANY (coalesce(p_project_ids, '{}')))
        OR (d.channel_id IS NOT NULL AND d.channel_id = ANY (coalesce(p_channel_ids, '{}')))
        OR (d.project_id IS NULL AND d.channel_id IS NULL
            AND (d.workspace_id IS NULL OR d.workspace_id = ANY (coalesce(p_workspace_ids, '{}'))))
      )
  ),
  q AS (
    SELECT websearch_to_tsquery('spanish', faro_unaccent(p_query)) AS tsq
  ),
  fts AS (
    SELECT s.id, row_number() OVER (ORDER BY ts_rank_cd(s.tsv, q.tsq) DESC) AS rnk
    FROM scoped s, q
    WHERE s.tsv @@ q.tsq
    ORDER BY ts_rank_cd(s.tsv, q.tsq) DESC
    LIMIT 50
  ),
  vec AS (
    SELECT s.id, row_number() OVER (ORDER BY s.embedding <=> p_embedding) AS rnk
    FROM scoped s
    WHERE p_embedding IS NOT NULL AND s.embedding IS NOT NULL
    ORDER BY s.embedding <=> p_embedding
    LIMIT 50
  ),
  fused AS (
    SELECT u.id, SUM(1.0 / (60 + u.rnk)) AS score
    FROM (SELECT id, rnk FROM fts UNION ALL SELECT id, rnk FROM vec) u
    GROUP BY u.id
  )
  SELECT s.entity_type, s.entity_id, s.title, left(s.body, 2000), s.project_id, s.channel_id,
         s.workspace_id, s.author_id, s.url, s.source_updated_at, f.score::double precision
  FROM fused f
  JOIN search_documents s ON s.id = f.id
  ORDER BY f.score DESC, s.source_updated_at DESC
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

REVOKE ALL ON FUNCTION search_hybrid(UUID, TEXT, vector, UUID[], UUID[], UUID[], TEXT[], INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_hybrid(UUID, TEXT, vector, UUID[], UUID[], UUID[], TEXT[], INT) TO service_role;
