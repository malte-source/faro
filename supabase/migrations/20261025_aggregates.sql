-- =============================================================================
-- Agregados de tareas en SQL (Fase 0 · fin del corte silencioso a 1.000 filas)
-- =============================================================================
--
-- projects.list y tasks.stats traían TODAS las tareas de los proyectos visibles
-- y las contaban en JS. PostgREST corta en 1.000 filas por defecto, así que los
-- contadores quedaban mal sin avisar, y los ids viajaban en la URL (crece ~37
-- bytes por proyecto). Estas funciones cuentan en la base y reciben los ids en
-- el cuerpo de la petición (rpc).
--
-- El código de la app funciona ANTES y DESPUÉS de aplicar este archivo: si la
-- función no existe, usa el camino anterior (paginado).
--
-- SECURITY INVOKER + solo service_role: la app es la única que las llama.
-- =============================================================================

-- Totales por proyecto (tareas de primer nivel): total, hechas y última actividad.
CREATE OR REPLACE FUNCTION project_task_stats(p_project_ids uuid[])
RETURNS TABLE (project_id uuid, total bigint, done bigint, last_activity timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    t.project_id,
    count(*)::bigint,
    (count(*) FILTER (WHERE t.status = 'done'))::bigint,
    max(t.updated_at)
  FROM tasks t
  WHERE t.project_id = ANY (p_project_ids)
    AND t.parent_task_id IS NULL
  GROUP BY t.project_id
$$;

-- Conteos por estado para el tablero: total, vencidas y mis pendientes (tareas de primer nivel).
CREATE OR REPLACE FUNCTION task_overview_stats(p_project_ids uuid[], p_user_id uuid, p_today date)
RETURNS TABLE (status text, total bigint, overdue bigint, mine_pending bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    t.status::text,
    count(*)::bigint,
    (count(*) FILTER (
      WHERE t.due_date IS NOT NULL AND t.due_date < p_today AND t.status NOT IN ('done', 'canceled')
    ))::bigint,
    (count(*) FILTER (
      WHERE t.assignee_id = p_user_id AND t.status NOT IN ('done', 'canceled')
    ))::bigint
  FROM tasks t
  WHERE t.project_id = ANY (p_project_ids)
    AND t.parent_task_id IS NULL
  GROUP BY t.status
$$;

-- Solo la app (service_role) las ejecuta; ni anon ni authenticated.
REVOKE ALL ON FUNCTION project_task_stats(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION task_overview_stats(uuid[], uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION project_task_stats(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION task_overview_stats(uuid[], uuid, date) TO service_role;

-- Índice que respalda ambos conteos (proyecto + primer nivel).
CREATE INDEX IF NOT EXISTS idx_tasks_project_toplevel
  ON tasks(project_id) WHERE parent_task_id IS NULL;
