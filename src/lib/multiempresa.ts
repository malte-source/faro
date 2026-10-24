import { addDays } from '@/lib/tz'

/**
 * Multiempresa helpers — pure functions shared by the client (live preview in
 * the quick-add bar, instant recompute of "sombrero" and warnings in the
 * capture review) and the server (which re-parses and validates).
 *
 * Vocabulary: Empresa = workspace · Sombrero = workspace_members (cargo of a
 * person inside one empresa).
 */

export const GUEST_HAT = 'Invitado'

/** Weekly capacity used for the load bars: 40 h = 100%. */
export const WEEK_CAPACITY_HOURS = 40
/** Above this many hours/week a person is flagged as overloaded. */
export const OVERLOAD_HOURS = 44
/** Between this and OVERLOAD_HOURS the number is shown as "near the limit". */
export const NEAR_LIMIT_HOURS = 36

export interface DirectoryPerson {
  id: string
  name: string
  memberships: Array<{ workspaceId: string; position: string }>
}

export interface DirectoryWorkspace {
  id: string
  name: string
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Match an alias typed after `#` or `@` against a display name (prefix of the whole name or of any word, ≥ 2 chars). */
function matchesAlias(alias: string, displayName: string): boolean {
  const a = normalize(alias)
  if (a.length < 2) return false
  const words = normalize(displayName).split(/[^a-z0-9]+/).filter(Boolean)
  return normalize(displayName).startsWith(a) || words.some(w => w.startsWith(a))
}

export function findWorkspaceByAlias(alias: string, workspaces: DirectoryWorkspace[]): DirectoryWorkspace | null {
  const exact = workspaces.find(w => normalize(w.name) === normalize(alias))
  if (exact) return exact
  const hits = workspaces.filter(w => matchesAlias(alias, w.name))
  return hits.length >= 1 ? hits[0] : null
}

export function findPersonByAlias(alias: string, people: DirectoryPerson[]): DirectoryPerson | null {
  const exact = people.find(p => normalize(p.name) === normalize(alias))
  if (exact) return exact
  const hits = people.filter(p => matchesAlias(alias, p.name))
  return hits.length >= 1 ? hits[0] : null
}

/** "Sombrero" = cargo of `personId` in `workspaceId`; "Invitado" when they have none there. */
export function hatFor(person: DirectoryPerson | null | undefined, workspaceId: string | null | undefined): string | null {
  if (!person || !workspaceId) return null
  return person.memberships.find(m => m.workspaceId === workspaceId)?.position ?? GUEST_HAT
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
}

/** Day of week (0 = Sunday) for a YYYY-MM-DD string. */
export function weekdayOf(isoDate: string): number {
  return new Date(isoDate + 'T12:00:00Z').getUTCDay()
}

/** Next occurrence of `weekday` strictly after `today` (so "viernes" said on a Friday means next Friday). */
export function nextWeekday(today: string, weekday: number): string {
  const diff = ((weekday - weekdayOf(today) + 7) % 7) || 7
  return addDays(today, diff)
}

/** Monday and Sunday (YYYY-MM-DD) of the week containing `isoDate`. */
export function weekBounds(isoDate: string): { monday: string; sunday: string } {
  const offsetToMon = (weekdayOf(isoDate) + 6) % 7
  const monday = addDays(isoDate, -offsetToMon)
  return { monday, sunday: addDays(monday, 6) }
}

export interface QuickAddParse {
  title: string
  workspaceId: string | null
  assigneeId: string | null
  dueDate: string | null
  hat: string | null
  /** Tokens recognised, for the "Faro entiende:" chips. */
  workspaceName: string | null
  assigneeName: string | null
}

export interface QuickAddContext {
  today: string
  people: DirectoryPerson[]
  workspaces: DirectoryWorkspace[]
  /** Active empresa filter (chip). Used when the text has no #tag. */
  filterWorkspaceId?: string | null
  /** Used when the text has no @person: default assignee (the author). */
  defaultAssigneeId?: string | null
}

/**
 * Parse `Pagar proveedores #mesa @andy viernes`:
 *   #tag     → empresa by alias (prefix ≥ 2 letters)
 *   @name    → person by alias
 *   hoy / mañana / weekday / dd/mm → due date (next occurrence)
 * Without #tag the empresa is the active filter; without a filter, the
 * assignee's first membership. The hat is the assignee's cargo there.
 */
export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAddParse {
  let workspace: DirectoryWorkspace | null = null
  let assignee: DirectoryPerson | null = null
  let dueDate: string | null = null
  const kept: string[] = []

  for (const raw of text.trim().split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('#') && raw.length > 1) {
      const w = findWorkspaceByAlias(raw.slice(1), ctx.workspaces)
      if (w) { workspace = w; continue }
    } else if (raw.startsWith('@') && raw.length > 1) {
      const p = findPersonByAlias(raw.slice(1), ctx.people)
      if (p) { assignee = p; continue }
    } else {
      const word = normalize(raw.replace(/[.,;:!?]+$/, ''))
      if (!dueDate) {
        if (word === 'hoy') { dueDate = ctx.today; continue }
        if (word === 'manana') { dueDate = addDays(ctx.today, 1); continue }
        if (word in WEEKDAYS) { dueDate = nextWeekday(ctx.today, WEEKDAYS[word]); continue }
        const dm = /^(\d{1,2})\/(\d{1,2})$/.exec(word)
        if (dm) {
          const day = Number(dm[1]); const month = Number(dm[2])
          if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
            const year = Number(ctx.today.slice(0, 4))
            let iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            if (iso < ctx.today) iso = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            dueDate = iso
            continue
          }
        }
      }
    }
    kept.push(raw)
  }

  const effectiveAssignee = assignee ?? ctx.people.find(p => p.id === ctx.defaultAssigneeId) ?? null

  let workspaceId: string | null = workspace?.id ?? ctx.filterWorkspaceId ?? null
  if (!workspaceId && effectiveAssignee) workspaceId = effectiveAssignee.memberships[0]?.workspaceId ?? null
  if (!workspaceId && ctx.workspaces.length === 1) workspaceId = ctx.workspaces[0].id
  const workspaceName = ctx.workspaces.find(w => w.id === workspaceId)?.name ?? null

  return {
    title: kept.join(' ').trim(),
    workspaceId,
    assigneeId: effectiveAssignee?.id ?? null,
    dueDate,
    hat: hatFor(effectiveAssignee, workspaceId),
    workspaceName,
    assigneeName: assignee?.name ?? null,
  }
}

export type ProposalWarning = 'sin_responsable' | 'sin_membresia' | 'sobrecarga'

export interface WarningInput {
  assigneeId: string | null
  workspaceId: string | null
  /** Load (0–100+) of the assignee in the week of the due date. */
  loadPct: number | null
}

/** Warning for a task proposal — computed by the server, recomputed live in the client when the assignee changes. */
export function proposalWarning(
  input: WarningInput,
  people: DirectoryPerson[],
): ProposalWarning | null {
  if (!input.assigneeId) return 'sin_responsable'
  const person = people.find(p => p.id === input.assigneeId)
  if (person && input.workspaceId && !person.memberships.some(m => m.workspaceId === input.workspaceId)) {
    return 'sin_membresia'
  }
  if (input.loadPct !== null && input.loadPct >= 120) return 'sobrecarga'
  return null
}
