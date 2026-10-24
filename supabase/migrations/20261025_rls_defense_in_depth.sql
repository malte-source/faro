-- =============================================================================
-- RLS como defensa en profundidad
-- =============================================================================
--
-- FARO accede a Postgres SOLO con la clave de servicio (que ignora RLS) y filtra
-- en los routers. La clave pública `anon` viaja en el navegador: si alguna tabla
-- quedara con RLS apagado, cualquiera con esa clave podría leerla o escribirla por
-- PostgREST. Hoy, medido el 24-oct-2026, la clave pública lee 0 filas en 26 tablas,
-- pero depender de un valor por defecto del proyecto es frágil.
--
-- Esto enciende RLS en TODA tabla de `public` que no lo tenga, sin crear políticas
-- (= nadie con la clave pública entra). La clave de servicio no se ve afectada.
-- Es idempotente: vuelve a correrlo después de crear tablas nuevas.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND NOT rowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
    RAISE NOTICE 'RLS activado en %.%', r.schemaname, r.tablename;
  END LOOP;
END $$;
