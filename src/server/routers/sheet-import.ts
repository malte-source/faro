import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { extractSheetId, getSpreadsheetTabs, getTabValues } from '@/lib/google-sheets'
import {
  guessKind, suggestMapping,
  coerceProjectStatus, coerceTaskStatus, coercePriority, coerceDate, deriveProjectCode,
  PROJECT_FIELDS, TASK_FIELDS,
} from '@/lib/sheet-import-mapping'

/**
 * Import the legacy "Matriz de Proyectos TPY" Google Sheet → FARO.
 *
 * Two-step UX:
 *   1. inspect(url)  → returns the tab list + headers + sample rows so the
 *      user (and we) can SEE the structure before importing.
 *   2. runImport(...) → maps the chosen tabs to projects/tasks/etc.
 *      (built once we've confirmed the structure from inspect).
 *
 * One-time, unidirectional. After import FARO is the source of truth.
 */
export const sheetImportRouter = createTRPCRouter({
  /** Read the spreadsheet structure: tabs + their first rows. */
  inspect: protectedProcedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sin token de Google — relogueate para conceder el permiso de Sheets.' })

      const sheetId = extractSheetId(input.url)
      if (!sheetId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'URL de Sheet inválida.' })

      let meta
      try {
        meta = await getSpreadsheetTabs(accessToken, sheetId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('403') || msg.includes('PERMISSION'))
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sin permiso para leer el Sheet. ¿Concediste el scope de Sheets al reloguear? ¿Tu cuenta tiene acceso al Sheet?' })
        if (msg.includes('404'))
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Sheet no encontrado. Verifica la URL.' })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: msg })
      }

      // Pull the first 6 rows of each tab as a preview, AND auto-propose a
      // (kind, fieldMapping) so the UI can render an editable plan immediately.
      const previews: {
        tab: string
        headers: string[]
        sampleRows: string[][]
        totalRows: number
        suggestedKind: 'projects' | 'tasks' | 'skip'
        suggestedMapping: Record<string, number | null>
      }[] = []
      for (const tab of meta.tabs.slice(0, 12)) {
        try {
          const rows = await getTabValues(accessToken, sheetId, tab.title, 6)
          const headers = rows[0] ?? []
          const kind = guessKind(tab.title, headers)
          previews.push({
            tab: tab.title,
            headers,
            sampleRows: rows.slice(1, 6),
            totalRows: tab.rowCount,
            suggestedKind: kind,
            suggestedMapping: kind === 'skip' ? {} : suggestMapping(headers, kind),
          })
        } catch {
          previews.push({
            tab: tab.title, headers: [], sampleRows: [], totalRows: tab.rowCount,
            suggestedKind: 'skip', suggestedMapping: {},
          })
        }
      }

      return { sheetId, title: meta.title, tabs: meta.tabs, previews }
    }),

  /**
   * Run the actual import based on the user-confirmed mapping.
   *
   * Behaviour:
   *   - Idempotent: skips projects whose `code` already exists in the org's
   *     workspace; skips tasks whose (project_id, title) already exists.
   *   - Two-pass: projects first (so tasks can resolve their project_code FK).
   *   - Tolerant: rows with no name/title are skipped silently.
   *   - Defaults: missing status → 'not_started' (project) / 'todo' (task);
   *     missing priority → 'medium'.
   *   - DryRun: when true, computes what WOULD be inserted and returns counts
   *     without touching the DB.
   */
  runImport: protectedProcedure
    .input(z.object({
      url: z.string(),
      workspaceId: z.string(),
      dryRun: z.boolean().default(false),
      sheets: z.array(z.object({
        tabTitle: z.string(),
        kind: z.enum(['projects', 'tasks', 'skip']),
        headerRow: z.number().int().min(0).default(0),
        // Map of field name (e.g. 'name', 'code') → column index (0-based).
        // Missing keys = field unmapped.
        mapping: z.record(z.string(), z.number().int().nullable()),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sin token de Google — relogueate.' })
      const sheetId = extractSheetId(input.url)
      if (!sheetId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'URL de Sheet inválida.' })

      // Verify workspace belongs to caller's org
      const { data: ws } = await ctx.supabase.from('workspaces').select('id, org_id').eq('id', input.workspaceId).single()
      if (!ws || ws.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Workspace inválido.' })

      const report = {
        dryRun: input.dryRun,
        projectsCreated: 0, projectsSkipped: 0,
        tasksCreated: 0, tasksSkipped: 0,
        warnings: [] as string[],
      }
      // Index of project code → id (existing + newly created), so tasks can FK.
      const codeToProjectId = new Map<string, string>()
      const { data: existingProjects } = await ctx.supabase
        .from('projects')
        .select('id, code')
        .eq('workspace_id', input.workspaceId)
      for (const p of existingProjects ?? []) codeToProjectId.set(p.code.toUpperCase(), p.id)

      // ── PASS 1: projects ─────────────────────────────────────────────
      const projectTabs = input.sheets.filter(s => s.kind === 'projects')
      for (const sheet of projectTabs) {
        let rows: string[][]
        try {
          rows = await getTabValues(accessToken, sheetId, sheet.tabTitle, 2000)
        } catch (err) {
          report.warnings.push(`Pestaña ${sheet.tabTitle}: error al leer (${err instanceof Error ? err.message : 'unknown'})`)
          continue
        }
        const dataRows = rows.slice(sheet.headerRow + 1)
        for (let ri = 0; ri < dataRows.length; ri++) {
          const row = dataRows[ri]
          const get = (field: string): string => {
            const idx = sheet.mapping[field]
            if (idx == null || idx < 0 || idx >= row.length) return ''
            return String(row[idx] ?? '').trim()
          }
          const name = get('name')
          if (!name) { report.projectsSkipped++; continue }
          let code = get('code').toUpperCase() || deriveProjectCode(name, ri + 1)
          // Disambiguate if code collides with a different project name.
          if (codeToProjectId.has(code) && !get('code')) {
            // We auto-generated — skip (already imported on a previous run).
            report.projectsSkipped++
            continue
          }
          if (codeToProjectId.has(code)) {
            report.projectsSkipped++
            continue
          }
          const insert = {
            workspace_id: input.workspaceId,
            code,
            name,
            description: get('description') || null,
            status: (coerceProjectStatus(get('status')) ?? 'not_started') as 'not_started',
            priority: (coercePriority(get('priority')) ?? 'medium') as 'medium',
            start_date: coerceDate(get('start_date')),
            end_date: coerceDate(get('end_date')),
            created_by: ctx.me.id,
          }
          if (input.dryRun) {
            report.projectsCreated++
            codeToProjectId.set(code, 'dry-run')
            continue
          }
          const { data, error } = await ctx.supabase
            .from('projects')
            .insert(insert)
            .select('id, code')
            .single()
          if (error) {
            report.warnings.push(`Pestaña ${sheet.tabTitle} fila ${ri + 2}: ${error.message}`)
            report.projectsSkipped++
            continue
          }
          codeToProjectId.set(data.code.toUpperCase(), data.id)
          report.projectsCreated++
          // Auto-add the creator as lead so the project appears in their list.
          await ctx.supabase.from('project_members').insert({
            project_id: data.id,
            user_id: ctx.me.id,
            role: 'lead' as const,
            added_by: ctx.me.id,
          })
        }
      }

      // ── PASS 2: tasks ────────────────────────────────────────────────
      const taskTabs = input.sheets.filter(s => s.kind === 'tasks')
      // Pre-load existing (project_id, title) pairs to dedupe.
      const existingTaskKeys = new Set<string>()
      if (codeToProjectId.size > 0 && !input.dryRun) {
        const ids = Array.from(new Set(codeToProjectId.values())).filter(id => id !== 'dry-run')
        if (ids.length) {
          const { data: existingTasks } = await ctx.supabase
            .from('tasks')
            .select('project_id, title')
            .in('project_id', ids)
          for (const t of existingTasks ?? []) existingTaskKeys.add(`${t.project_id}::${t.title.toLowerCase()}`)
        }
      }

      for (const sheet of taskTabs) {
        let rows: string[][]
        try {
          rows = await getTabValues(accessToken, sheetId, sheet.tabTitle, 5000)
        } catch (err) {
          report.warnings.push(`Pestaña ${sheet.tabTitle}: error al leer (${err instanceof Error ? err.message : 'unknown'})`)
          continue
        }
        const dataRows = rows.slice(sheet.headerRow + 1)
        for (let ri = 0; ri < dataRows.length; ri++) {
          const row = dataRows[ri]
          const get = (field: string): string => {
            const idx = sheet.mapping[field]
            if (idx == null || idx < 0 || idx >= row.length) return ''
            return String(row[idx] ?? '').trim()
          }
          const title = get('title')
          if (!title) { report.tasksSkipped++; continue }
          const projCode = get('project_code').toUpperCase()
          const projectId = codeToProjectId.get(projCode)
          if (!projectId) {
            report.warnings.push(`Pestaña ${sheet.tabTitle} fila ${ri + 2}: proyecto "${projCode}" no encontrado.`)
            report.tasksSkipped++
            continue
          }
          const dedupeKey = `${projectId}::${title.toLowerCase()}`
          if (existingTaskKeys.has(dedupeKey)) { report.tasksSkipped++; continue }
          const labelsRaw = get('labels')
          const insert = {
            project_id: projectId,
            title,
            description: get('description') || null,
            status: (coerceTaskStatus(get('status')) ?? 'todo') as 'todo',
            priority: (coercePriority(get('priority')) ?? 'medium') as 'medium',
            due_date: coerceDate(get('due_date')),
            reporter_id: ctx.me.id,
            labels: labelsRaw ? labelsRaw.split(/[,;|]/).map(s => s.trim()).filter(Boolean) : [],
            position: Date.now() + ri,
          }
          if (input.dryRun) {
            report.tasksCreated++
            existingTaskKeys.add(dedupeKey)
            continue
          }
          if (projectId === 'dry-run') { report.tasksSkipped++; continue }
          const { error } = await ctx.supabase.from('tasks').insert(insert)
          if (error) {
            report.warnings.push(`Pestaña ${sheet.tabTitle} fila ${ri + 2}: ${error.message}`)
            report.tasksSkipped++
            continue
          }
          existingTaskKeys.add(dedupeKey)
          report.tasksCreated++
        }
      }

      return report
    }),

  /** Expose the available field lists so the UI can render mapping selectors. */
  fields: protectedProcedure.query(() => ({
    projects: [...PROJECT_FIELDS],
    tasks: [...TASK_FIELDS],
  })),
})
