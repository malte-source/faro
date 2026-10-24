# Migraciones de FARO

FARO usa Supabase (Postgres). **No hay herramienta automática de migraciones todavía**: cada archivo de
`migrations/` se pega completo en el *SQL Editor* de Supabase y se corre una vez. Todos son idempotentes
(`IF NOT EXISTS`, `ON CONFLICT`), así que repetirlos no rompe nada.

El orden es el del nombre del archivo. Estado al 24-oct-2026:

| Archivo | Qué hace | Estado |
| --- | --- | --- |
| `001`–`004` | Esquema inicial, semilla de TPY, índices, comentarios | Aplicado |
| `20260525_*` – `20260611_*` | Decisiones, chat de Google, campos personalizados, sprints, plantillas, tiempo, automatizaciones, formularios, objetivos, correo entrante, enlaces compartidos, zonas horarias, multi-workspace | Aplicado |
| `20260912_org_structure` | Capas corporativas, líneas sólida y punteada, código de rol, KPI | Aplicado |
| `20261022_multiempresa` | Sombreros por empresa, proyectos compartidos, visibilidad por empresa | Aplicado |
| `20261022_captura` | Capturas y propuestas de tareas | Aplicado |
| `20261022_chat` | Canales, mensajes, reacciones | Aplicado |
| `20261023_documents` | Documentos y versiones | Aplicado |
| `20261024_costos` | Costos intercompany: pools, métricas, corridas | Aplicado |
| `20261024_security_hardening` | Capa corporativa por grupo; una sola Bandeja por empresa | Aplicado |
| `20261025_aggregates` | Funciones SQL para conteos de proyectos y tareas (fin del corte a 1.000 filas). El código funciona con y sin ella | Aplicado |
| `20261025_rls_defense_in_depth` | Enciende RLS (sin políticas) en toda tabla pública que no lo tenga | Aplicado |
| `20261026_ai_usage` | Medidor y presupuestos de IA: `ai_usage`, `ai_budgets` y la función `ai_usage_rollup`. El código funciona antes y después de aplicarla (sin ella no mide ni limita) | Aplicado |
| `20261026_capture_idempotency` | `captures.client_id` + índice único (persona, clave): reintentos seguros de la bandeja de salida del celular, sin capturas duplicadas. El código funciona antes y después de aplicarla (sin ella no deduplica) | Aplicado |
| `20261026_notifications` | Avisos reales: `notifications` (bandeja persistida), `push_subscriptions` (dispositivos) y `user_notification_prefs`. Sin ella los avisos no se guardan ni llegan (el código no falla) | Aplicado |
| `20261027_email_prefs` | Correo: preferencias de resumen y avisos en `user_notification_prefs` (`email_digest`, `digest_hour`, `email_instant`, `email_kinds`, `last_digest_at`) y la tabla `email_log` (tope diario). Requiere además los secretos SMTP. Sin ella el código no falla: simplemente no envía correos | Pendiente |
| `20260608_automations` | Automatizaciones (`automations`, `automation_runs`). **Nunca se había aplicado**: la pantalla de Automatizaciones daba error | **Pendiente** |
| `20260609_share_links` | Enlaces públicos de solo lectura para clientes (`share_links`). **Nunca se había aplicado** | **Pendiente** |
| `20261027_chat_counts` | Función `chat_unread_counts` (no leídos y menciones exactos en una consulta, con vista previa del último mensaje) e índice de reacciones por fecha. Sin ella el chat usa el cálculo anterior (hasta 1.500 mensajes por sondeo) | **Pendiente** |
| `20261027_search` | Búsqueda híbrida (texto + significado): extensiones `vector` y `unaccent`, tablas `search_documents` y `search_index_state`, función `search_hybrid` (RRF, con permisos aplicados en SQL). Requiere el cron `/api/cron/search-index` (Cloud Scheduler, cada 5 min) para indexar. Sin ella la búsqueda cae a modo básico (ILIKE) | **Pendiente** |

## Comprobaciones (corren contra la base real, solo lectura)

- `node scripts/check-schema.mjs`: compara las tablas y columnas de las migraciones con la base. Detecta migraciones que nunca se aplicaron.
- `node scripts/check-embeds.mjs`: ejecuta todas las consultas con relaciones del código.
- `pnpm exec vitest run --config vitest.smoke.config.ts`: llama a todos los procedimientos de consulta del servidor como el dueño, en cada grupo. Falla ante cualquier error 500.

Córrelas en ese orden después de aplicar SQL y antes de desplegar.

## Reglas

1. Un archivo nuevo por cambio, con fecha `AAAAMMDD_nombre.sql`. No editar uno ya aplicado: se agrega otro.
2. Todo debe ser idempotente.
3. FARO accede **solo con la clave de servicio** y filtra en los routers; por eso las tablas nuevas no llevan
   políticas RLS. Aun así, corre `20261025_rls_defense_in_depth.sql` después de crear tablas nuevas.
4. Después de aplicar, verifica con una consulta (columnas o conteos) antes de desplegar código que dependa de ello.
5. **Corre `node scripts/check-embeds.mjs` después de cada migración y antes de cada despliegue.** Ejecuta contra la
   base real todas las consultas con relaciones del código. Una tabla nueva puede volver ambigua una consulta vieja
   (el 24-oct-2026 `project_workspaces` hizo ambigua la relación `workspaces → projects` y la app dejó de cargar).
   La solución es una pista explícita: `projects!projects_workspace_id_fkey(...)`.
5. Los datos semilla de La Trinchera viven en `../scripts/seed-trinchera-*.mjs` (idempotentes, buscan por nombre).

## Próximo paso recomendado

Adoptar la CLI de Supabase (`supabase db push`) con un proyecto *staging*, y generar los tipos con
`supabase gen types` en lugar de mantener `src/types/database.ts` a mano.
