/**
 * Heuristics for auto-detecting the column mapping when importing a Google
 * Sheet into FARO. The user can override anything in the UI before running.
 *
 * Strategy: normalise header text (lowercase, strip diacritics, drop punctuation)
 * and match against per-field synonym lists in ES + EN. First column whose
 * header matches wins for that field.
 */

const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const norm = (s: string) => stripDiacritics(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]/g, '').trim()

/** Fields a project row can carry. `null` = unmapped. */
export const PROJECT_FIELDS = [
  'code', 'name', 'description', 'status', 'kanban_stage', 'priority',
  'start_date', 'end_date', 'health_score', 'department', 'budget',
] as const
export type ProjectField = typeof PROJECT_FIELDS[number]

/** Fields a task row can carry. */
export const TASK_FIELDS = [
  'project_code', 'title', 'description', 'assignee', 'status',
  'priority', 'due_date', 'labels', 'estimated_hours',
] as const
export type TaskField = typeof TASK_FIELDS[number]

/** Per-field header synonyms (normalised). Add aggressively — heuristic only. */
const SYNONYMS: Record<ProjectField | TaskField, string[]> = {
  // ── projects ────────────────────────────────────────────
  code: ['codigo', 'code', 'id', 'ref', 'referencia', 'sku', 'clave'],
  name: ['nombre', 'name', 'proyecto', 'project', 'titulo', 'title'],
  description: ['descripcion', 'description', 'detalle', 'detail', 'notas', 'notes', 'desc'],
  status: ['estado', 'status', 'state', 'situacion'],
  kanban_stage: ['etapa', 'stage', 'kanban', 'fase', 'phase'],
  priority: ['prioridad', 'priority', 'urgencia', 'urgency'],
  start_date: ['inicio', 'start', 'startdate', 'fechainicio', 'desde', 'from'],
  end_date: ['fin', 'end', 'enddate', 'fechafin', 'deadline', 'vencimiento', 'hasta', 'to', 'duedate', 'vence'],
  health_score: ['salud', 'health', 'score', 'healthscore', 'puntaje'],
  department: ['departamento', 'department', 'area', 'equipo', 'team', 'dept'],
  budget: ['presupuesto', 'budget', 'monto', 'amount', 'costo', 'cost'],
  // ── tasks ───────────────────────────────────────────────
  project_code: ['proyecto', 'project', 'codigoproyecto', 'projectcode', 'projectid'],
  title: ['titulo', 'title', 'nombre', 'name', 'tarea', 'task'],
  assignee: ['asignado', 'assignee', 'responsable', 'owner', 'persona', 'email', 'correo', 'usuario', 'user'],
  labels: ['etiquetas', 'labels', 'tags', 'categorias'],
  estimated_hours: ['horas', 'horasestimadas', 'estimatedhours', 'eta', 'estimado'],
  due_date: ['vence', 'vencimiento', 'deadline', 'duedate', 'fechalimite', 'fin', 'end'],
}

/**
 * Best-guess kind for a tab name. Returns 'projects' | 'tasks' | 'skip'.
 * Looks for keywords in the tab title; falls back to inspecting the headers.
 */
export function guessKind(tabTitle: string, headers: string[]): 'projects' | 'tasks' | 'skip' {
  const t = norm(tabTitle)
  if (/(proyecto|project|matriz|portfolio|portafolio)/.test(t)) return 'projects'
  if (/(tarea|task|todo|backlog|sprint|pendiente)/.test(t)) return 'tasks'
  // Header-based fallback
  const heads = headers.map(norm)
  const has = (...keys: string[]) => keys.some(k => heads.some(h => h.includes(k)))
  if (has('tarea', 'task') || (has('proyecto', 'project') && has('responsable', 'asignado', 'assignee'))) return 'tasks'
  if (has('proyecto', 'project') || has('matriz')) return 'projects'
  return 'skip'
}

/**
 * Auto-suggest a {field → columnIndex} mapping for the given headers and kind.
 * Greedy first-match wins; if no column matches, the field is left unmapped.
 */
export function suggestMapping(
  headers: string[],
  kind: 'projects' | 'tasks',
): Record<string, number | null> {
  const fields = (kind === 'projects' ? PROJECT_FIELDS : TASK_FIELDS) as readonly string[]
  const used = new Set<number>()
  const mapping: Record<string, number | null> = {}
  const normHeaders = headers.map(norm)

  for (const field of fields) {
    const syns = SYNONYMS[field as ProjectField | TaskField] ?? []
    let idx: number | null = null
    for (let i = 0; i < normHeaders.length; i++) {
      if (used.has(i)) continue
      const h = normHeaders[i]
      if (!h) continue
      if (syns.includes(h) || syns.some(s => h === s || h.includes(s))) {
        idx = i
        used.add(i)
        break
      }
    }
    mapping[field] = idx
  }
  return mapping
}

// ── Value coercion helpers ─────────────────────────────────

const STATUS_MAP: Record<string, string> = {
  // project statuses
  'noiniciado': 'not_started', 'pendiente': 'not_started', 'porhacer': 'not_started', 'todo': 'not_started', 'nostarted': 'not_started', 'notstarted': 'not_started',
  'enprogreso': 'in_progress', 'enproceso': 'in_progress', 'activo': 'in_progress', 'inprogress': 'in_progress', 'doing': 'in_progress', 'ejecucion': 'in_progress',
  'enespera': 'on_hold', 'pausado': 'on_hold', 'onhold': 'on_hold', 'standby': 'on_hold',
  'demorado': 'delayed', 'retrasado': 'delayed', 'delayed': 'delayed', 'atrasado': 'delayed',
  'completado': 'completed', 'completo': 'completed', 'finalizado': 'completed', 'terminado': 'completed', 'cerrado': 'completed', 'done': 'completed', 'completed': 'completed',
  'cancelado': 'canceled', 'canceled': 'canceled', 'cancelled': 'canceled',
}

const PRIORITY_MAP: Record<string, string> = {
  'muyalta': 'very_high', 'critica': 'very_high', 'urgente': 'very_high', 'critical': 'very_high', 'veryhigh': 'very_high',
  'alta': 'high', 'high': 'high',
  'media': 'medium', 'normal': 'medium', 'medium': 'medium',
  'baja': 'low', 'low': 'low',
  'muybaja': 'very_low', 'verylow': 'very_low',
}

const TASK_STATUS_MAP: Record<string, string> = {
  'porhacer': 'todo', 'todo': 'todo', 'pendiente': 'todo', 'noiniciado': 'todo',
  'enprogreso': 'in_progress', 'haciendo': 'in_progress', 'inprogress': 'in_progress', 'doing': 'in_progress', 'activo': 'in_progress',
  'enrevision': 'in_review', 'revisando': 'in_review', 'inreview': 'in_review', 'review': 'in_review',
  'hecho': 'done', 'completado': 'done', 'terminado': 'done', 'done': 'done', 'completed': 'done',
  'cancelado': 'canceled', 'canceled': 'canceled',
}

/** Coerce a raw cell to one of the project status enum values, or null. */
export function coerceProjectStatus(raw: string): string | null {
  return STATUS_MAP[norm(raw)] ?? null
}
/** Coerce a raw cell to one of the task status enum values, or null. */
export function coerceTaskStatus(raw: string): string | null {
  return TASK_STATUS_MAP[norm(raw)] ?? null
}
/** Coerce a raw cell to one of the priority enum values, or null. */
export function coercePriority(raw: string): string | null {
  return PRIORITY_MAP[norm(raw)] ?? null
}

/**
 * Parse a date cell to ISO YYYY-MM-DD. Accepts:
 *   - already-ISO strings
 *   - DD/MM/YYYY or DD-MM-YYYY
 *   - MM/DD/YYYY (ambiguous — preferred only if first part > 12)
 *   - Google Sheets serial numbers (days since 1899-12-30)
 */
export function coerceDate(raw: string | number): string | null {
  if (raw == null || raw === '') return null
  // Sheets serial number
  if (typeof raw === 'number' || /^\d{1,6}(\.\d+)?$/.test(String(raw).trim())) {
    const serial = typeof raw === 'number' ? raw : parseFloat(raw)
    if (serial > 0 && serial < 80000) {
      const ms = (serial - 25569) * 86400 * 1000 // 25569 = days from 1970-01-01 to 1899-12-30
      const d = new Date(ms)
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    }
  }
  const s = String(raw).trim()
  // ISO already
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (dmy) {
    let [, d, m, y] = dmy
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

/** Generate a project code from a name when none is provided. */
export function deriveProjectCode(name: string, index: number): string {
  const slug = stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12)
  return slug ? `${slug}-${String(index).padStart(3, '0')}` : `IMPORT-${String(index).padStart(3, '0')}`
}
