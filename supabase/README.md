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
| `20261025_aggregates` | Funciones SQL para conteos de proyectos y tareas (fin del corte a 1.000 filas). El código funciona con y sin ella | **Pendiente** |
| `20261025_rls_defense_in_depth` | Enciende RLS (sin políticas) en toda tabla pública que no lo tenga | **Pendiente** |

## Reglas

1. Un archivo nuevo por cambio, con fecha `AAAAMMDD_nombre.sql`. No editar uno ya aplicado: se agrega otro.
2. Todo debe ser idempotente.
3. FARO accede **solo con la clave de servicio** y filtra en los routers; por eso las tablas nuevas no llevan
   políticas RLS. Aun así, corre `20261025_rls_defense_in_depth.sql` después de crear tablas nuevas.
4. Después de aplicar, verifica con una consulta (columnas o conteos) antes de desplegar código que dependa de ello.
5. Los datos semilla de La Trinchera viven en `../scripts/seed-trinchera-*.mjs` (idempotentes, buscan por nombre).

## Próximo paso recomendado

Adoptar la CLI de Supabase (`supabase db push`) con un proyecto *staging*, y generar los tipos con
`supabase gen types` en lugar de mantener `src/types/database.ts` a mano.
