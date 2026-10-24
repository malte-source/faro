-- =============================================================================
-- Chat: conteo de no leídos en Postgres (fin del sondeo caro)
-- =============================================================================
--
-- Antes: `chat.unreadTotal` (cada 20 s por persona) y `chat.channels` traían hasta
-- 1.500 mensajes COMPLETOS y los contaban en JavaScript; pasado ese tope los
-- números quedaban mal. Ahora lo calcula una sola consulta agregada, exacta.
--
-- Reglas idénticas a las de la app:
--   • no cuenta mis propios mensajes ni los borrados;
--   • cuenta lo posterior a mi última lectura (con piso de 30 días, como antes);
--   • menciones = mi id en `mentions` o `mention_all`;
--   • además devuelve el último mensaje de primer nivel de cada canal (vista previa).
-- La app usa esta función si existe y, si no, el cálculo anterior: se puede
-- desplegar antes o después de aplicar este SQL.
-- =============================================================================

CREATE OR REPLACE FUNCTION chat_unread_counts(p_user UUID, p_org UUID)
RETURNS TABLE (
  channel_id        UUID,
  unread            BIGINT,
  mentions          BIGINT,
  last_message_at   TIMESTAMPTZ,
  last_message_body TEXT,
  last_author_id    UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    cm.channel_id,
    COALESCE(c.unread, 0)   AS unread,
    COALESCE(c.mentions, 0) AS mentions,
    lm.created_at           AS last_message_at,
    lm.body                 AS last_message_body,
    lm.author_id            AS last_author_id
  FROM chat_members cm
  JOIN chat_channels ch
    ON ch.id = cm.channel_id
   AND ch.org_id = p_org
   AND ch.archived_at IS NULL
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                                                         AS unread,
      COUNT(*) FILTER (WHERE m.mention_all OR p_user = ANY (m.mentions)) AS mentions
    FROM chat_messages m
    WHERE m.channel_id = cm.channel_id
      AND m.deleted_at IS NULL
      AND m.author_id IS DISTINCT FROM p_user
      AND m.created_at > GREATEST(cm.last_read_at, now() - INTERVAL '30 days')
  ) c ON TRUE
  LEFT JOIN LATERAL (
    SELECT m.created_at, m.body, m.author_id
    FROM chat_messages m
    WHERE m.channel_id = cm.channel_id
      AND m.parent_id IS NULL
      AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON TRUE
  WHERE cm.user_id = p_user;
$$;

REVOKE ALL ON FUNCTION chat_unread_counts(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_unread_counts(UUID, UUID) TO service_role;

-- El índice (channel_id, created_at DESC) de 20261022_chat.sql ya sirve para los dos LATERAL.
-- Las reacciones nuevas se buscan por fecha en cada sondeo incremental del canal abierto.
CREATE INDEX IF NOT EXISTS idx_chat_reactions_created ON chat_reactions(created_at);
