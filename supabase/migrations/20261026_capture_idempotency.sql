-- =============================================================================
-- Captura sin conexión: reintentos seguros (idempotencia)
-- =============================================================================
--
-- El celular guarda cada captura en una bandeja de salida local y la reenvía
-- hasta que llega. Cada captura lleva un `client_id` (UUID generado en el
-- dispositivo): si la respuesta se pierde y el cliente reintenta, el servidor
-- devuelve la MISMA captura en vez de crear (y procesar con IA) otra.
--
-- El código funciona antes y después de aplicar esto: sin la columna, simplemente
-- no hay deduplicación (comportamiento anterior).
-- =============================================================================

ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS client_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_captures_client
  ON captures(created_by, client_id)
  WHERE client_id IS NOT NULL;

COMMENT ON COLUMN captures.client_id IS 'Clave de idempotencia generada en el dispositivo; única por persona. Null en capturas antiguas.';
