import { z } from 'zod'
import { todayInTZ } from '@/lib/tz'
import { taskOverviewStats } from '@/server/aggregates'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { generateFlash } from '@/lib/gemini'
import { parseAiJson, fenceUntrusted } from '@/lib/ai-json'
import { parsedTaskSchema, parsedAudioTaskSchema, parsedImageTaskSchema, meetingTasksSchema, nextSuggestionSchema } from '@/server/ai-schemas'
import { enforceRateLimit, gcBuckets } from '@/lib/rate-limit'
import { limitsFor, requireFeature } from '@/lib/plan-limits'
import { triggerAutomations } from '@/lib/automations'
import type { TaskStatus } from '@/types/database'

export const tasksRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
      projectId: z.string().optional(),
      assigneeId: z.string().optional(),
      /** Filter by reviewer (the user expected to approve the task). */
      reviewerId: z.string().optional(),
      /** Filter by label (any task that has this label in its labels array). */
      label: z.string().optional(),
      onlyMine: z.boolean().optional(),
      /** Filter tasks with due_date within next N days (overdue + today + +N). */
      dueWithinDays: z.number().int().min(0).max(365).optional(),
      /** Only tasks that have at least one INCOMPLETE dependency — "blocked". */
      onlyBlocked: z.boolean().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { me, projectIds: allProjectIds } = ctx
      if (!allProjectIds.length) return []

      // Use project IDs from context cache — no extra DB round-trip needed.
      const projectIds = input?.projectId
        ? allProjectIds.filter(id => id === input.projectId)
        : allProjectIds
      if (!projectIds.length) return []

      let query = ctx.supabase
        .from('tasks')
        .select(`
          *,
          assignee:users!tasks_assignee_id_fkey(id, name, avatar_url),
          project:projects(id, code, name, color),
          blocking:task_dependencies!task_dependencies_task_id_fkey(
            id,
            depends_on:tasks!task_dependencies_depends_on_id_fkey(id, title, status)
          )
        `)
        .in('project_id', projectIds)
        .is('parent_task_id', null)
        .order('created_at', { ascending: false })
        .limit(500)

      if (input?.status) query = query.eq('status', input.status)
      if (input?.priority) query = query.eq('priority', input.priority)
      if (input?.assigneeId) query = query.eq('assignee_id', input.assigneeId)
      if (input?.reviewerId) query = query.eq('reviewer_id', input.reviewerId)
      if (input?.onlyMine) query = query.eq('assignee_id', me.id)
      if (input?.label) query = query.contains('labels', [input.label])
      if (input?.dueWithinDays !== undefined) {
        // Compute upper bound in caller TZ — overdue tasks pass (no lower bound).
        const today = new Date()
        const upper = new Date(today.getTime() + input.dueWithinDays * 86_400_000)
        query = query.lte('due_date', upper.toISOString().slice(0, 10))
      }

      const { data, error } = await query
      if (error) throw error

      // `onlyBlocked` filtering happens client-side on the embed — Supabase
      // can't filter by nested computed status. Cheap enough for ≤500 rows.
      if (input?.onlyBlocked) {
        type Row = NonNullable<typeof data>[number]
        return (data ?? []).filter((t: Row) => {
          const blocking = (t as Row & {
            blocking?: Array<{ depends_on: { status: string } | null }>
          }).blocking ?? []
          return blocking.some(b => b.depends_on && b.depends_on.status !== 'done' && b.depends_on.status !== 'canceled')
        })
      }
      return data
    }),

  byProject: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      // Embed task_dependencies so the UI can show a 🔗 indicator on tasks
      // that are blocked by something still open. `blocking` here = rows where
      // THIS task depends on another (we exclude `depends_on` because we
      // don't currently show "what this task blocks").
      const { data, error } = await ctx.supabase
        .from('tasks')
        .select(`
          *,
          assignee:users!tasks_assignee_id_fkey(id, name, avatar_url),
          subtasks:tasks!parent_task_id(id, title, status, priority),
          blocking:task_dependencies!task_dependencies_task_id_fkey(
            id,
            depends_on:tasks!task_dependencies_depends_on_id_fkey(id, title, status)
          )
        `)
        .eq('project_id', input)
        .is('parent_task_id', null)
        .order('position')
        .limit(500)

      if (error) throw error
      return data
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      title: z.string().min(1),
      description: z.string().optional(),
      assigneeId: z.string().optional(),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).default('medium'),
      dueDate: z.string().optional(),
      estimatedHours: z.number().optional(),
      parentTaskId: z.string().optional(),
      labels: z.array(z.string()).default([]),
      status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).default('todo'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx

      // Use timestamp-based position — avoids a pre-insert SELECT round-trip.
      // Ordering within a project remains correct since newer tasks get higher values.
      const { data, error } = await ctx.supabase
        .from('tasks')
        .insert({
          project_id: input.projectId,
          title: input.title,
          description: input.description ?? null,
          assignee_id: input.assigneeId ?? null,
          reporter_id: me.id,
          priority: input.priority,
          status: input.status,
          due_date: input.dueDate,
          estimated_hours: input.estimatedHours,
          parent_task_id: input.parentTaskId,
          labels: input.labels,
          position: Date.now(),
        })
        .select()
        .single()

      if (error) throw error

      // Fire automations matching 'task.created' for the org.
      void triggerAutomations(ctx.supabase, {
        trigger: 'task.created',
        org_id: ctx.me.org_id,
        task: {
          id: data.id,
          project_id: data.project_id,
          title: data.title,
          status: data.status,
          priority: data.priority,
          assignee_id: data.assignee_id,
          due_date: data.due_date,
          labels: data.labels ?? [],
        },
      })

      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      // IDOR fix: only allow deleting tasks that belong to one of the user's projects.
      // `ctx.projectIds` is org-scoped in createTRPCContext, so this is the
      // enforcement point.
      const { error } = await ctx.supabase
        .from('tasks')
        .delete()
        .eq('id', input)
        .in('project_id', ctx.projectIds)
      if (error) throw error
      return { success: true }
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const { me, projectIds } = ctx
    if (!projectIds.length) {
      return { byStatus: { todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 }, total: 0, myPending: 0, overdue: 0 }
    }

    const today = todayInTZ(undefined, ctx.tz)

    // Counted in SQL (rpc): exact totals, no 1,000-row truncation. See src/server/aggregates.ts.
    return taskOverviewStats(ctx.supabase, projectIds, me.id, today)
  }),

  /**
   * "¿Qué hago ahora?" — Gemini ranks the user's pending tasks by what to
   * tackle next, based on priority + due date + project context.
   * Returns top 3 with reasoning. Falls back to a deterministic ranking
   * if the AI call fails (no Gemini key set, rate limit, etc.).
   */
  nextSuggestion: protectedProcedure.mutation(async ({ ctx }) => {
    enforceRateLimit(`${ctx.me.id}:nextSuggestion`)
    gcBuckets()
    const { me, projectIds } = ctx
    if (!projectIds.length) return { ranked: [], summary: 'Sin proyectos todavía.' }

    const { data: tasks } = await ctx.supabase
      .from('tasks')
      .select('id, title, priority, due_date, status, project:projects(code, name)')
      .in('project_id', projectIds)
      .eq('assignee_id', me.id)
      .neq('status', 'done')
      .neq('status', 'canceled')
      .is('parent_task_id', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50)

    type Row = NonNullable<typeof tasks>[number]
    const list = (tasks ?? []) as Row[]

    if (!list.length) {
      return { ranked: [], summary: '¡Todo al día! No tienes tareas pendientes asignadas.' }
    }

    // Deterministic fallback ranking: priority weight + days-to-due penalty.
    const PRIORITY_WEIGHT: Record<string, number> = {
      very_high: 100, high: 70, medium: 40, low: 15, very_low: 5,
    }
    const today = Date.now()
    const score = (t: Row): number => {
      let s = PRIORITY_WEIGHT[t.priority] ?? 40
      if (t.due_date) {
        const days = (new Date(t.due_date + 'T23:59:59').getTime() - today) / 86_400_000
        if (days < 0) s += 60 + Math.min(40, -days * 3)
        else if (days < 1) s += 50
        else if (days < 3) s += 30
        else if (days < 7) s += 10
      }
      return s
    }
    const sorted = [...list].sort((a, b) => score(b) - score(a))
    const fallback = {
      ranked: sorted.slice(0, 3).map(t => ({
        taskId: t.id,
        title: t.title,
        projectCode: (t.project as { code: string } | null)?.code ?? null,
        reason: `Prioridad ${t.priority.replace('_', ' ')}${t.due_date ? ` · vence ${t.due_date}` : ''}`,
      })),
      summary: 'Ordenado por prioridad + cercanía del vencimiento.',
    }

    // Try Gemini for nicer reasoning — free plans silently keep the
    // deterministic fallback above rather than erroring (this is an
    // enhancement over a working heuristic, not a hard requirement).
    if (limitsFor(ctx.activeOrg?.plan).ai) try {
      const prompt = `Eres un asistente de productividad. Te paso ${list.length} tareas pendientes asignadas al usuario. Decide cuáles 3 debe atacar PRIMERO, en orden, y explica brevemente por qué cada una.

Devuelve JSON estrictamente con este formato:
{
  "summary": "una frase de orientación general (≤ 15 palabras)",
  "ranked": [
    { "taskId": "<id>", "reason": "<una frase ≤ 18 palabras, en español>" },
    { "taskId": "<id>", "reason": "..." },
    { "taskId": "<id>", "reason": "..." }
  ]
}

Tareas (id | título | prioridad | vence | proyecto):
${fenceUntrusted('tareas pendientes', list.slice(0, 20).map(t => {
  const proj = (t.project as { code: string; name: string } | null)
  return `${t.id} | ${t.title} | ${t.priority} | ${t.due_date ?? 'sin fecha'} | ${proj?.code ?? '?'} ${proj?.name ?? ''}`
}).join('\n'))}

Hoy es ${todayInTZ(undefined, ctx.tz)}.
Devuelve solo el JSON, sin markdown.`

      const parsed = parseAiJson(
        await generateFlash(prompt, { feature: 'tasks.nextSuggestion', orgId: ctx.activeOrg?.id }),
        nextSuggestionSchema,
      )
      // Enrich with title + project for the client
      const byId = new Map(list.map(t => [t.id, t]))
      return {
        summary: parsed.summary,
        ranked: parsed.ranked
          .filter(r => byId.has(r.taskId))
          .slice(0, 3)
          .map(r => {
            const t = byId.get(r.taskId)!
            return {
              taskId: t.id,
              title: t.title,
              projectCode: (t.project as { code: string } | null)?.code ?? null,
              reason: r.reason,
            }
          }),
      }
    } catch (err) {
      console.warn('[tasks.nextSuggestion] Gemini failed, using fallback:', err)
      return fallback
    }
    return fallback
  }),

  /**
   * Natural-language quick-add. User types free-form text like:
   *   "tarea revisar contrato cliente Acme para el viernes alta @mancuello"
   * Gemini parses it into structured fields, we resolve project code and
   * assignee name against the org's data, then create the task.
   *
   * Returns BOTH the parsed plan (so the UI can show a preview/confirm)
   * AND the created task (so optimistic UI works).
   */
  parseAndCreate: protectedProcedure
    .input(z.object({
      text: z.string().min(3).max(500),
      // If `confirmed = false` we ONLY parse + return the plan, without
      // creating anything. The UI calls again with confirmed = true once
      // the user reviews. This lets us avoid spurious task creation.
      confirmed: z.boolean().default(false),
      // Override fields after user editing the preview
      override: z.object({
        title: z.string().optional(),
        projectId: z.string().nullable().optional(),
        assigneeId: z.string().nullable().optional(),
        priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
        dueDate: z.string().nullable().optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Crear tarea con IA')
      // Rate-limit BEFORE doing any work — protects Gemini quota even from
      // a buggy client that retries on its own.
      enforceRateLimit(`${ctx.me.id}:parseAndCreate`)
      gcBuckets()
      const { me, workspaceIds, projectIds } = ctx
      if (!projectIds.length) throw new Error('Sin proyectos en el workspace.')

      // Load context for Gemini: available projects and team members.
      const [{ data: projects }, { data: members }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name')
          .in('workspace_id', workspaceIds)
          .neq('status', 'completed')
          .neq('status', 'canceled')
          .limit(60),
        ctx.supabase
          .from('users')
          .select('id, name')
          .eq('org_id', me.org_id)
          .eq('is_active', true)
          .limit(40),
      ])

      const projectList = (projects ?? []).map(p => `${p.code} → ${p.name}`).join('\n')
      const memberList = (members ?? []).map(m => m.name).join(', ')

      const today = todayInTZ(undefined, ctx.tz)
      const prompt = `Convierte esta descripción libre de tarea a JSON estructurado.

CONTEXTO:
Hoy: ${today}
Proyectos disponibles (código → nombre):
${projectList || '(sin proyectos)'}
Personas del equipo: ${memberList || '(sin personas)'}

TEXTO:
"${input.text}"

Reglas:
- "title" debe ser un título limpio sin metadata (sin "@usuario", sin fechas, sin "alta/baja").
- "projectCode" si el texto menciona un código (P-1, P12, etc.) o el NOMBRE de un proyecto del contexto.
- "priority" infiere del lenguaje ("urgente"/"crítico"=very_high, "alta"=high, etc.). Default "medium".
- "dueDate" en YYYY-MM-DD. Acepta "mañana", "viernes", "en 3 días", "fin de mes", "15 de junio".
- "assigneeName" si menciona "@persona" o "para María" o "asignar a Juan" — devuelve el nombre tal como aparece en el equipo si lo identificas.
- "description" solo si hay info adicional que no entra en el title.

Devuelve SOLO JSON, sin markdown ni backticks:
{
  "title": "...",
  "projectCode": "..." | null,
  "priority": "very_high"|"high"|"medium"|"low"|"very_low",
  "dueDate": "YYYY-MM-DD" | null,
  "assigneeName": "..." | null,
  "description": "..." | null
}`

      // ── 1. Parse with Gemini ───────────────────────────────────────
      type Parsed = {
        title: string
        projectCode: string | null
        priority: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
        dueDate: string | null
        assigneeName: string | null
        description: string | null
      }

      let parsed: Parsed
      try {
        parsed = parseAiJson(
          await generateFlash(prompt, { feature: 'tasks.parseAndCreate', orgId: ctx.activeOrg?.id }),
          parsedTaskSchema,
        )
      } catch (err) {
        console.warn('[tasks.parseAndCreate] gemini failed, using fallback:', err)
        // Deterministic fallback: just use the text as the title
        parsed = {
          title: input.text.slice(0, 200),
          projectCode: null,
          priority: 'medium',
          dueDate: null,
          assigneeName: null,
          description: null,
        }
      }

      // ── 2. Resolve references ──────────────────────────────────────
      const projectMatch = parsed.projectCode
        ? (projects ?? []).find(p => p.code.toLowerCase() === parsed.projectCode!.toLowerCase())
        : null

      const assigneeMatch = parsed.assigneeName
        ? (members ?? []).find(m =>
            m.name.toLowerCase().includes(parsed.assigneeName!.toLowerCase()) ||
            parsed.assigneeName!.toLowerCase().includes(m.name.toLowerCase().split(' ')[0]),
          )
        : null

      // Resolved plan (mix Gemini's parse with override + DB lookups)
      const resolved = {
        title: input.override?.title ?? parsed.title,
        projectId: input.override?.projectId !== undefined
          ? input.override.projectId
          : (projectMatch?.id ?? null),
        assigneeId: input.override?.assigneeId !== undefined
          ? input.override.assigneeId
          : (assigneeMatch?.id ?? null),
        priority: input.override?.priority ?? parsed.priority,
        dueDate: input.override?.dueDate !== undefined
          ? input.override.dueDate
          : parsed.dueDate,
        description: parsed.description,
        // For UI preview only:
        _projectLabel: projectMatch ? `${projectMatch.code} · ${projectMatch.name}` : null,
        _assigneeLabel: assigneeMatch?.name ?? null,
      }

      // ── 3. Preview only? Return the plan without creating ───────────
      if (!input.confirmed) {
        return { stage: 'preview' as const, plan: resolved, parsed }
      }

      // ── 4. Create the task ─────────────────────────────────────────
      // Project is required for task creation. If unresolved, fall back
      // to first available project so the user isn't blocked.
      const projectId = resolved.projectId ?? projectIds[0]
      if (!projectId) throw new Error('No hay proyectos donde crear la tarea.')

      const { data: created, error } = await ctx.supabase
        .from('tasks')
        .insert({
          project_id: projectId,
          title: resolved.title,
          description: resolved.description,
          assignee_id: resolved.assigneeId,
          reporter_id: me.id,
          priority: resolved.priority,
          status: 'todo',
          due_date: resolved.dueDate,
          position: Date.now(),
          labels: [],
        })
        .select()
        .single()
      if (error) throw error

      return { stage: 'created' as const, task: created, plan: resolved }
    }),

  /**
   * Audio → tarea. User records/uploads audio, Gemini multimodal transcribes
   * AND parses task fields in one shot.
   *
   * Same two-step UX as parseAndCreate: first call (confirmed=false) just
   * returns the preview plan; user reviews, then confirms.
   */
  parseAudioAndCreate: protectedProcedure
    .input(z.object({
      audioBase64: z.string().min(100),       // raw base64 audio
      mimeType: z.string().default('audio/webm'),
      confirmed: z.boolean().default(false),
      override: z.object({
        title: z.string().optional(),
        projectId: z.string().nullable().optional(),
        assigneeId: z.string().nullable().optional(),
        priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
        dueDate: z.string().nullable().optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Audio a tarea con IA')
      enforceRateLimit(`${ctx.me.id}:parseAudio`, { tokensPerMinute: 0.2, maxBurst: 5 })
      gcBuckets()
      const { me, workspaceIds, projectIds } = ctx
      if (!projectIds.length) throw new Error('Sin proyectos en el workspace.')

      const [{ data: projects }, { data: members }] = await Promise.all([
        ctx.supabase
          .from('projects').select('id, code, name')
          .in('workspace_id', workspaceIds)
          .neq('status', 'completed').neq('status', 'canceled').limit(60),
        ctx.supabase
          .from('users').select('id, name')
          .eq('org_id', me.org_id).eq('is_active', true).limit(40),
      ])

      const projectList = (projects ?? []).map(p => `${p.code} → ${p.name}`).join('\n')
      const memberList = (members ?? []).map(m => m.name).join(', ')
      const today = todayInTZ(undefined, ctx.tz)
      const prompt = `Tienes un AUDIO de un usuario describiendo una tarea. Transcríbelo y extrae sus campos a JSON estructurado.

CONTEXTO:
Hoy: ${today}
Proyectos disponibles (código → nombre):
${projectList || '(sin proyectos)'}
Personas: ${memberList || '(sin personas)'}

Devuelve SOLO JSON sin markdown:
{
  "transcript": "<lo que dijo, literal>",
  "title": "<título limpio sin metadata>",
  "projectCode": "..." | null,
  "priority": "very_high"|"high"|"medium"|"low"|"very_low",
  "dueDate": "YYYY-MM-DD" | null,
  "assigneeName": "..." | null,
  "description": "..." | null
}

Acepta fechas como "mañana", "viernes", "en 3 días", "fin de mes".`

      type Parsed = {
        transcript: string
        title: string
        projectCode: string | null
        priority: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
        dueDate: string | null
        assigneeName: string | null
        description: string | null
      }

      let parsed: Parsed
      try {
        parsed = parseAiJson(
          await generateFlash(
            [prompt, { inlineData: { data: input.audioBase64, mimeType: input.mimeType } }],
            { feature: 'tasks.parseAudioAndCreate', orgId: ctx.activeOrg?.id },
          ),
          parsedAudioTaskSchema,
        )
      } catch (err) {
        console.warn('[tasks.parseAudioAndCreate] Gemini failed:', err)
        throw new Error('No se pudo procesar el audio. Intenta de nuevo o usa el modo texto.')
      }

      const projectMatch = parsed.projectCode
        ? (projects ?? []).find(p => p.code.toLowerCase() === parsed.projectCode!.toLowerCase())
        : null
      const assigneeMatch = parsed.assigneeName
        ? (members ?? []).find(m =>
            m.name.toLowerCase().includes(parsed.assigneeName!.toLowerCase()) ||
            parsed.assigneeName!.toLowerCase().includes(m.name.toLowerCase().split(' ')[0]),
          )
        : null

      const resolved = {
        title: input.override?.title ?? parsed.title,
        projectId: input.override?.projectId !== undefined ? input.override.projectId : (projectMatch?.id ?? null),
        assigneeId: input.override?.assigneeId !== undefined ? input.override.assigneeId : (assigneeMatch?.id ?? null),
        priority: input.override?.priority ?? parsed.priority,
        dueDate: input.override?.dueDate !== undefined ? input.override.dueDate : parsed.dueDate,
        description: parsed.description,
        _projectLabel: projectMatch ? `${projectMatch.code} · ${projectMatch.name}` : null,
        _assigneeLabel: assigneeMatch?.name ?? null,
        _transcript: parsed.transcript,
      }

      if (!input.confirmed) {
        return { stage: 'preview' as const, plan: resolved, parsed }
      }

      const projectId = resolved.projectId ?? projectIds[0]
      if (!projectId) throw new Error('No hay proyectos donde crear la tarea.')

      const { data: created, error } = await ctx.supabase
        .from('tasks')
        .insert({
          project_id: projectId,
          title: resolved.title,
          description: resolved.description,
          assignee_id: resolved.assigneeId,
          reporter_id: me.id,
          priority: resolved.priority,
          status: 'todo',
          due_date: resolved.dueDate,
          position: Date.now(),
          labels: ['audio'],
        })
        .select()
        .single()
      if (error) throw error
      return { stage: 'created' as const, task: created, plan: resolved }
    }),

  /**
   * Image → tarea con Gemini multimodal.
   * Acepta screenshots, fotos de pizarra/notas, o imágenes con texto.
   * Gemini hace OCR + interpretación + extracción de campos.
   */
  parseImageAndCreate: protectedProcedure
    .input(z.object({
      imageBase64: z.string().min(100),
      mimeType: z.string().default('image/png'),
      confirmed: z.boolean().default(false),
      override: z.object({
        title: z.string().optional(),
        projectId: z.string().nullable().optional(),
        assigneeId: z.string().nullable().optional(),
        priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
        dueDate: z.string().nullable().optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Imagen a tarea con IA')
      enforceRateLimit(`${ctx.me.id}:parseImage`, { tokensPerMinute: 0.2, maxBurst: 5 })
      gcBuckets()
      const { me, workspaceIds, projectIds } = ctx
      if (!projectIds.length) throw new Error('Sin proyectos en el workspace.')

      const [{ data: projects }, { data: members }] = await Promise.all([
        ctx.supabase.from('projects').select('id, code, name')
          .in('workspace_id', workspaceIds)
          .neq('status', 'completed').neq('status', 'canceled').limit(60),
        ctx.supabase.from('users').select('id, name')
          .eq('org_id', me.org_id).eq('is_active', true).limit(40),
      ])

      const projectList = (projects ?? []).map(p => `${p.code} → ${p.name}`).join('\n')
      const memberList = (members ?? []).map(m => m.name).join(', ')
      const today = todayInTZ(undefined, ctx.tz)
      const prompt = `Te paso una IMAGEN. Puede ser: un screenshot, una foto de un brief, una pizarra escrita a mano, una captura de chat, un post-it. Identifica la TAREA principal que describe y extráela a JSON.

CONTEXTO:
Hoy: ${today}
Proyectos: ${projectList || '(sin proyectos)'}
Personas: ${memberList || '(sin personas)'}

Devuelve SOLO JSON sin markdown:
{
  "extracted_text": "<lo que leíste en la imagen, OCR literal>",
  "title": "<título limpio de la tarea>",
  "projectCode": "..." | null,
  "priority": "very_high"|"high"|"medium"|"low"|"very_low",
  "dueDate": "YYYY-MM-DD" | null,
  "assigneeName": "..." | null,
  "description": "<si hay info adicional relevante>" | null
}`

      type Parsed = {
        extracted_text: string
        title: string
        projectCode: string | null
        priority: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
        dueDate: string | null
        assigneeName: string | null
        description: string | null
      }

      let parsed: Parsed
      try {
        parsed = parseAiJson(
          await generateFlash(
            [prompt, { inlineData: { data: input.imageBase64, mimeType: input.mimeType } }],
            { feature: 'tasks.parseImageAndCreate', orgId: ctx.activeOrg?.id },
          ),
          parsedImageTaskSchema,
        )
      } catch (err) {
        console.warn('[tasks.parseImageAndCreate] Gemini failed:', err)
        throw new Error('No se pudo procesar la imagen. Intenta con otra o usa el modo texto.')
      }

      const projectMatch = parsed.projectCode
        ? (projects ?? []).find(p => p.code.toLowerCase() === parsed.projectCode!.toLowerCase())
        : null
      const assigneeMatch = parsed.assigneeName
        ? (members ?? []).find(m =>
            m.name.toLowerCase().includes(parsed.assigneeName!.toLowerCase()) ||
            parsed.assigneeName!.toLowerCase().includes(m.name.toLowerCase().split(' ')[0]))
        : null

      const resolved = {
        title: input.override?.title ?? parsed.title,
        projectId: input.override?.projectId !== undefined ? input.override.projectId : (projectMatch?.id ?? null),
        assigneeId: input.override?.assigneeId !== undefined ? input.override.assigneeId : (assigneeMatch?.id ?? null),
        priority: input.override?.priority ?? parsed.priority,
        dueDate: input.override?.dueDate !== undefined ? input.override.dueDate : parsed.dueDate,
        description: parsed.description,
        _projectLabel: projectMatch ? `${projectMatch.code} · ${projectMatch.name}` : null,
        _assigneeLabel: assigneeMatch?.name ?? null,
        _transcript: parsed.extracted_text,
      }

      if (!input.confirmed) return { stage: 'preview' as const, plan: resolved, parsed }

      const projectId = resolved.projectId ?? projectIds[0]
      if (!projectId) throw new Error('No hay proyectos donde crear la tarea.')

      const { data: created, error } = await ctx.supabase
        .from('tasks').insert({
          project_id: projectId,
          title: resolved.title,
          description: resolved.description,
          assignee_id: resolved.assigneeId,
          reporter_id: me.id,
          priority: resolved.priority,
          status: 'todo',
          due_date: resolved.dueDate,
          position: Date.now(),
          labels: ['imagen'],
        })
        .select().single()
      if (error) throw error
      return { stage: 'created' as const, task: created, plan: resolved }
    }),

  /**
   * Priority feed cross-project — D3.
   * Returns the top tasks ordered by composite urgency score across
   * everything the user can see. Used by the Priorities dashboard.
   */
  priorityFeed: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.projectIds.length) return []
    const today = new Date()
    const todayISO = today.toISOString().split('T')[0]
    const DAY = 86_400_000

    const { data, error } = await ctx.supabase
      .from('tasks')
      .select(`
        id, title, status, priority, due_date, review_state,
        assignee:users!tasks_assignee_id_fkey(id, name, avatar_url),
        project:projects(id, code, name, color, health_score)
      `)
      .in('project_id', ctx.projectIds)
      .neq('status', 'done').neq('status', 'canceled')
      .is('parent_task_id', null)
      .limit(300)
    if (error) throw error

    const W: Record<string, number> = { very_high: 100, high: 70, medium: 40, low: 15, very_low: 5 }
    type Row = NonNullable<typeof data>[number]
    const scored = (data ?? []).map(t => {
      let s = W[t.priority] ?? 40
      if (t.due_date) {
        const due = new Date(t.due_date + 'T23:59:59Z').getTime()
        const daysOverdue = (today.getTime() - due) / DAY
        if (daysOverdue > 0) s += Math.min(60, 10 + daysOverdue * 5) // overdue snowballs
        else if (daysOverdue > -1) s += 25                            // due today
        else if (daysOverdue > -3) s += 15                            // due in ≤3 days
        else if (daysOverdue > -7) s += 5                             // this week
      }
      const proj = t.project as { health_score?: number | null } | null
      if (proj?.health_score != null && proj.health_score < 50) s += 10 // unhealthy project bump
      if (t.status === 'in_progress') s += 5 // already in flight, don't drop
      return { ...t, _score: Math.round(s), _overdue: t.due_date ? t.due_date < todayISO : false }
    }) as (Row & { _score: number; _overdue: boolean })[]

    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, 40)
  }),

  /**
   * Bulk update multiple tasks at once. Useful for power-user multi-select:
   *   - re-assign 10 tasks to a different team member
   *   - mark a batch as done
   *   - shift due dates en masse
   * Returns the count of updated rows.
   */
  bulkUpdate: protectedProcedure
    .input(z.object({
      ids: z.array(z.string()).min(1).max(200),
      changes: z.object({
        status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
        priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
        assigneeId: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      // Build a strongly-typed patch object so the Supabase update signature
      // matches the tasks.Update type generated in database.ts.
      const patch: {
        status?: 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled'
        priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
        assignee_id?: string | null
        due_date?: string | null
      } = {}
      if (input.changes.status) patch.status = input.changes.status
      if (input.changes.priority) patch.priority = input.changes.priority
      if (input.changes.assigneeId !== undefined) patch.assignee_id = input.changes.assigneeId
      if (input.changes.dueDate !== undefined) patch.due_date = input.changes.dueDate

      if (Object.keys(patch).length === 0) return { updated: 0 }

      // IDOR fix: filter by user's projectIds so a malicious caller can't
      // mutate tasks across orgs by passing arbitrary UUIDs.
      const { error, count } = await ctx.supabase
        .from('tasks')
        .update(patch, { count: 'exact' })
        .in('id', input.ids)
        .in('project_id', ctx.projectIds)

      if (error) throw error
      return { updated: count ?? 0 }
    }),

  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      // IDOR fix: same project_id whitelist as bulkUpdate.
      const { error, count } = await ctx.supabase
        .from('tasks')
        .delete({ count: 'exact' })
        .in('id', input.ids)
        .in('project_id', ctx.projectIds)
      if (error) throw error
      return { deleted: count ?? 0 }
    }),

  // ── Review workflow ──────────────────────────────────────────────────
  /**
   * Assignee marks the task as ready for review.
   * Moves status → in_review, review_state → requested, and fires a Chat
   * notification mentioning the reviewer (if the org has a webhook set).
   */
  requestReview: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('tasks')
        .update({ status: 'in_review', review_state: 'requested' })
        .eq('id', input.id)
        .in('project_id', ctx.projectIds)
        .select('id, title, reviewer_id, project:projects(id, code)')
        .single()
      if (error) throw error
      return data
    }),

  approveReview: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Only the assigned reviewer (or admin) can approve.
      const { data: t } = await ctx.supabase
        .from('tasks').select('reviewer_id, project_id').eq('id', input.id).single()
      if (!t || !ctx.projectIds.includes(t.project_id)) throw new Error('No autorizado.')
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      if (t.reviewer_id !== ctx.me.id && !isAdmin) throw new Error('Solo el revisor asignado o un admin pueden aprobar.')

      const { data, error } = await ctx.supabase
        .from('tasks')
        .update({ status: 'done', review_state: 'approved' })
        .eq('id', input.id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  requestChanges: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: t } = await ctx.supabase
        .from('tasks').select('reviewer_id, project_id').eq('id', input.id).single()
      if (!t || !ctx.projectIds.includes(t.project_id)) throw new Error('No autorizado.')
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      if (t.reviewer_id !== ctx.me.id && !isAdmin) throw new Error('Solo el revisor o un admin pueden pedir cambios.')

      const { data, error } = await ctx.supabase
        .from('tasks')
        .update({ status: 'in_progress', review_state: 'changes_requested' })
        .eq('id', input.id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  /** Flattened export of tasks (for CSV download client-side). */
  exportRows: protectedProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const ids = input?.projectId
        ? ctx.projectIds.filter(id => id === input.projectId)
        : ctx.projectIds
      if (!ids.length) return [] as Array<{
        codigo_proyecto: string; proyecto: string; titulo: string; estado: string
        prioridad: string; asignado: string; revisor: string; vence: string
        creada: string; horas_estimadas: string; horas_reales: string; etiquetas: string
        doc: string
      }>

      const { data } = await ctx.supabase
        .from('tasks')
        .select(`
          title, status, priority, due_date, estimated_hours, actual_hours, labels,
          drive_url, created_at,
          assignee:users!tasks_assignee_id_fkey(name),
          reviewer:users!tasks_reviewer_id_fkey(name),
          project:projects(code, name)
        `)
        .in('project_id', ids)
        .is('parent_task_id', null)
        .order('created_at', { ascending: false })
        .limit(5000)

      return (data ?? []).map(t => {
        const a = t.assignee as { name?: string } | null
        const r = t.reviewer as { name?: string } | null
        const p = t.project as { code?: string; name?: string } | null
        return {
          codigo_proyecto: p?.code ?? '',
          proyecto: p?.name ?? '',
          titulo: t.title,
          estado: t.status,
          prioridad: t.priority,
          asignado: a?.name ?? '',
          revisor: r?.name ?? '',
          vence: t.due_date ?? '',
          creada: t.created_at?.split('T')[0] ?? '',
          horas_estimadas: t.estimated_hours != null ? String(t.estimated_hours) : '',
          horas_reales: t.actual_hours != null ? String(t.actual_hours) : '',
          etiquetas: (t.labels ?? []).join(', '),
          doc: t.drive_url ?? '',
        }
      })
    }),

  // ── "Mi día" — tasks the current user needs to focus on today ────────
  /**
   * Tasks with a due_date inside [from, to] (inclusive). Used by the /week and
   * /month views. Returns ALL projects the user can see — Day/Week/Month views
   * are cross-project by design (it's about your time, not a single project).
   *
   * `mineOnly`: when true, restrict to tasks assigned to me. Default = false
   * (covers admin scope) so the same procedure powers both "tu semana" and
   * "la semana del equipo".
   */
  byDateRange: protectedProcedure
    .input(z.object({
      from: z.string(),  // YYYY-MM-DD in caller's TZ
      to: z.string(),    // YYYY-MM-DD in caller's TZ
      mineOnly: z.boolean().default(true),
      includeDone: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.projectIds.length) return []
      let q = ctx.supabase
        .from('tasks')
        .select(`
          id, title, status, priority, due_date, estimated_hours,
          assignee_id, reviewer_id,
          assignee:users!tasks_assignee_id_fkey(id, name, avatar_url),
          project:projects(id, code, name, color)
        `)
        .in('project_id', ctx.projectIds)
        .not('due_date', 'is', null)
        .gte('due_date', input.from)
        .lte('due_date', input.to)
        .is('parent_task_id', null)
        .order('due_date')
        .limit(500)
      if (input.mineOnly) q = q.eq('assignee_id', ctx.me.id)
      if (!input.includeDone) q = q.neq('status', 'done').neq('status', 'canceled')
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    }),

  /** Move a task to a new due_date (used by week/month drag-drop). */
  reschedule: protectedProcedure
    .input(z.object({
      taskId: z.string().uuid(),
      newDueDate: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.projectIds.length) throw new Error('No projects')
      // IDOR guard: the task must belong to a project the caller sees.
      const { data: task } = await ctx.supabase
        .from('tasks')
        .select('id, project_id')
        .eq('id', input.taskId)
        .single()
      if (!task || !ctx.projectIds.includes(task.project_id)) throw new Error('Sin acceso')
      const { error } = await ctx.supabase
        .from('tasks')
        .update({ due_date: input.newDueDate, updated_at: new Date().toISOString() })
        .eq('id', input.taskId)
      if (error) throw error
      return { ok: true }
    }),

  myDay: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.projectIds.length) return { dueToday: [], overdue: [], inProgress: [], reviewing: [] }
    const today = todayInTZ(undefined, ctx.tz)

    const { data, error } = await ctx.supabase
      .from('tasks')
      .select(`
        id, title, status, priority, due_date, drive_url, review_state, reviewer_id,
        project:projects(id, code, name, color)
      `)
      .in('project_id', ctx.projectIds)
      .or(`assignee_id.eq.${ctx.me.id},reviewer_id.eq.${ctx.me.id}`)
      .neq('status', 'done')
      .neq('status', 'canceled')
      .is('parent_task_id', null)
      .order('priority')
      .limit(200)
    if (error) throw error

    const all = data ?? []
    const dueToday: typeof all = []
    const overdue: typeof all = []
    const inProgress: typeof all = []
    const reviewing: typeof all = []

    for (const t of all) {
      // Reviewing bucket: I am the reviewer AND it's awaiting my review
      if (t.reviewer_id === ctx.me.id && t.review_state === 'requested') {
        reviewing.push(t)
        continue
      }
      if (t.due_date && t.due_date < today) {
        overdue.push(t)
      } else if (t.due_date === today) {
        dueToday.push(t)
      } else if (t.status === 'in_progress') {
        inProgress.push(t)
      }
    }
    return { dueToday, overdue, inProgress, reviewing }
  }),

  // ── Dependencies ─────────────────────────────────────────────────────
  /** List all dependency edges within a project (for Gantt arrows). */
  dependenciesByProject: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input: projectId }) => {
      if (!ctx.projectIds.includes(projectId)) return []
      // Fetch all tasks in project, then their deps. Two-step is cheaper
      // than a JOIN here because Supabase JS doesn't compose deep filters.
      const { data: taskRows } = await ctx.supabase
        .from('tasks')
        .select('id')
        .eq('project_id', projectId)
      const taskIds = (taskRows ?? []).map(t => t.id)
      if (taskIds.length === 0) return []

      const { data, error } = await ctx.supabase
        .from('task_dependencies')
        .select('id, task_id, depends_on_id')
        .in('task_id', taskIds)
      if (error) throw error
      return data ?? []
    }),

  addDependency: protectedProcedure
    .input(z.object({ taskId: z.string(), dependsOnId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.taskId === input.dependsOnId) {
        throw new Error('Una tarea no puede depender de sí misma.')
      }
      // Verify both tasks belong to one of our projects
      const { data: rows } = await ctx.supabase
        .from('tasks')
        .select('id, project_id')
        .in('id', [input.taskId, input.dependsOnId])
      if (!rows || rows.length !== 2) {
        throw new Error('Una de las tareas no existe.')
      }
      for (const t of rows) {
        if (!ctx.projectIds.includes(t.project_id)) {
          throw new Error('No autorizado.')
        }
      }
      // Optional but recommended: prevent cycles via a simple BFS upward
      // from dependsOnId — if we reach taskId, the new edge would close a cycle.
      const visited = new Set<string>([input.dependsOnId])
      const queue = [input.dependsOnId]
      while (queue.length) {
        const current = queue.shift()!
        const { data: parents } = await ctx.supabase
          .from('task_dependencies')
          .select('depends_on_id')
          .eq('task_id', current)
        for (const p of parents ?? []) {
          if (p.depends_on_id === input.taskId) {
            throw new Error('Esa dependencia crearía un ciclo.')
          }
          if (!visited.has(p.depends_on_id)) {
            visited.add(p.depends_on_id)
            queue.push(p.depends_on_id)
          }
        }
      }

      const { data, error } = await ctx.supabase
        .from('task_dependencies')
        .insert({ task_id: input.taskId, depends_on_id: input.dependsOnId })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  removeDependency: protectedProcedure
    .input(z.string()) // dependency id
    .mutation(async ({ ctx, input }) => {
      // Verify the task referenced is in our org's projects.
      const { data: dep } = await ctx.supabase
        .from('task_dependencies')
        .select('task:tasks!task_dependencies_task_id_fkey(project_id)')
        .eq('id', input)
        .maybeSingle()
      const projectId = (dep?.task as { project_id?: string } | null)?.project_id
      if (!projectId || !ctx.projectIds.includes(projectId)) {
        throw new Error('No autorizado.')
      }
      const { error } = await ctx.supabase.from('task_dependencies').delete().eq('id', input)
      if (error) throw error
      return { success: true }
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
      assigneeId: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      actualHours: z.number().optional(),
      driveUrl: z.string().nullable().optional(),
      reviewerId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input

      // Capture the previous status BEFORE updating so we can fire
      // task.status_changed automations only on real transitions (not
      // re-saves of the same status).
      let prevStatus: TaskStatus | null = null
      if (rest.status) {
        const { data: prev } = await ctx.supabase
          .from('tasks').select('status').eq('id', id).single()
        prevStatus = (prev?.status ?? null) as TaskStatus | null
      }

      // IDOR fix: scope update to user's own projects.
      const { data, error } = await ctx.supabase
        .from('tasks')
        .update({
          ...(rest.title && { title: rest.title }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.status && { status: rest.status }),
          ...(rest.priority && { priority: rest.priority }),
          ...(rest.assigneeId !== undefined && { assignee_id: rest.assigneeId }),
          ...(rest.dueDate !== undefined && { due_date: rest.dueDate }),
          ...(rest.actualHours !== undefined && { actual_hours: rest.actualHours }),
          ...(rest.driveUrl !== undefined && { drive_url: rest.driveUrl }),
          ...(rest.reviewerId !== undefined && { reviewer_id: rest.reviewerId }),
        })
        .eq('id', id)
        .in('project_id', ctx.projectIds)
        .select()
        .single()

      if (error) throw error

      // Fire status-change automation if the status actually transitioned.
      if (rest.status && prevStatus && prevStatus !== rest.status) {
        void triggerAutomations(ctx.supabase, {
          trigger: 'task.status_changed',
          org_id: ctx.me.org_id,
          task: {
            id: data.id, project_id: data.project_id, title: data.title,
            status: data.status, priority: data.priority,
            assignee_id: data.assignee_id, due_date: data.due_date,
            labels: data.labels ?? [],
          },
          from_status: prevStatus,
          to_status: rest.status as TaskStatus,
        })
      }

      return data
    }),

  /**
   * Parse meeting notes / transcript text → array of preview action items.
   *
   * The UX is two-step: this procedure ONLY extracts a draft list of tasks
   * (assignee resolved against team members, due_date inferred if mentioned).
   * The user reviews + edits, then commits via `bulkCreate`.
   *
   * Why not auto-create here? Meeting transcripts are noisy — Gemini can
   * hallucinate tasks. A human review step prevents 5 phantom tasks from
   * appearing in the project every Monday.
   */
  parseMeetingNotes: protectedProcedure
    .input(z.object({
      rawText: z.string().min(20).max(50_000),
      /** Optional default project for any tasks where Gemini can't infer one. */
      defaultProjectId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Notas de reunión con IA')
      enforceRateLimit(`${ctx.me.id}:parseMeeting`)
      gcBuckets()
      const { me, workspaceIds, projectIds } = ctx
      if (!projectIds.length) throw new Error('Sin proyectos en el workspace.')

      const [{ data: projects }, { data: members }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name')
          .in('workspace_id', workspaceIds)
          .neq('status', 'completed')
          .neq('status', 'canceled')
          .limit(60),
        ctx.supabase
          .from('users')
          .select('id, name')
          .eq('org_id', me.org_id)
          .eq('is_active', true)
          .limit(40),
      ])

      const projectList = (projects ?? []).map(p => `${p.code} → ${p.name} [${p.id}]`).join('\n')
      const memberList = (members ?? []).map(m => `${m.name} [${m.id}]`).join('\n')
      const today = todayInTZ(undefined, ctx.tz)

      const prompt = `Analiza estas notas de una reunión y extrae los ACTION ITEMS (tareas concretas con dueño).

REGLAS:
- Solo acciones concretas, no observaciones ni decisiones (a menos que generen una tarea).
- Si la acción menciona a una persona específica como responsable, resolvelo al user_id.
- Si menciona "todos" o nadie, deja assignee_id = null.
- Fechas: si dice "para el viernes", "antes del 15", etc., calcula la fecha YYYY-MM-DD basándote en hoy (${today}).
- Si la acción claramente pertenece a un proyecto mencionado (por nombre o tema), pon project_id.
- Prioridad: very_high si urgente/crítico, high si importante, medium default.
- Title corto y accionable (verbo + objeto). Description con contexto si es útil.

PROYECTOS DISPONIBLES (código → nombre [id]):
${projectList || '(ninguno)'}

EQUIPO (nombre [id]):
${memberList || '(ninguno)'}

NOTAS DE LA REUNIÓN:
${fenceUntrusted('notas de la reunión', input.rawText.slice(0, 30_000))}

Devuelve SOLO un JSON array sin markdown:
[
  {
    "title": "Acción concreta corta",
    "description": "Contexto opcional",
    "project_id": "<uuid o null>",
    "assignee_id": "<uuid o null>",
    "priority": "very_high|high|medium|low|very_low",
    "due_date": "YYYY-MM-DD o null",
    "confidence": "high|medium|low"
  }
]
Si no hay action items claros, devuelve []. No inventes tareas.`

      type ParsedTask = {
        title: string
        description?: string | null
        project_id?: string | null
        assignee_id?: string | null
        priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
        due_date?: string | null
        confidence?: 'high' | 'medium' | 'low'
      }

      let parsed: ParsedTask[] = []
      try {
        parsed = parseAiJson(
          await generateFlash(prompt, { feature: 'tasks.parseMeetingNotes', orgId: ctx.activeOrg?.id }),
          meetingTasksSchema,
        )
      } catch (err) {
        console.error('[parseMeetingNotes] gemini failed', err)
        throw new Error('No se pudo procesar las notas. Intenta en un momento.')
      }

      // Sanitise + fall back to defaultProjectId when Gemini didn't pick one.
      const validProjectIds = new Set((projects ?? []).map(p => p.id))
      const validUserIds = new Set((members ?? []).map(m => m.id))
      const cleaned = parsed
        .filter(t => t.title && t.title.trim().length > 0)
        .map(t => ({
          title: t.title.trim().slice(0, 200),
          description: t.description?.trim() || null,
          project_id: t.project_id && validProjectIds.has(t.project_id)
            ? t.project_id
            : (input.defaultProjectId && validProjectIds.has(input.defaultProjectId)
                ? input.defaultProjectId
                : null),
          assignee_id: t.assignee_id && validUserIds.has(t.assignee_id) ? t.assignee_id : null,
          priority: (['very_high', 'high', 'medium', 'low', 'very_low'].includes(t.priority ?? '') ? t.priority : 'medium') as ParsedTask['priority'],
          due_date: t.due_date && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null,
          confidence: (['high', 'medium', 'low'].includes(t.confidence ?? '') ? t.confidence : 'medium') as ParsedTask['confidence'],
        }))

      return { tasks: cleaned, projects: projects ?? [], members: members ?? [] }
    }),

  /**
   * Bulk-insert multiple tasks at once. Used by the Meet-to-tasks importer
   * after the user reviews + edits the preview.
   *
   * Each task must include a projectId the caller can write to (anti-IDOR).
   * Returns the created task count and any per-row errors so the UI can
   * surface partial failures.
   */
  bulkCreate: protectedProcedure
    .input(z.object({
      tasks: z.array(z.object({
        title: z.string().min(1).max(200),
        description: z.string().nullable().optional(),
        projectId: z.string(),
        assigneeId: z.string().nullable().optional(),
        priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).default('medium'),
        dueDate: z.string().nullable().optional(),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me, projectIds } = ctx
      // Anti-IDOR: every task must target a project the caller can see.
      const invalid = input.tasks.find(t => !projectIds.includes(t.projectId))
      if (invalid) throw new Error(`Sin acceso al proyecto destino: ${invalid.projectId}`)

      const baseTs = Date.now()
      const rows = input.tasks.map((t, i) => ({
        project_id: t.projectId,
        title: t.title,
        description: t.description ?? null,
        assignee_id: t.assigneeId ?? null,
        reporter_id: me.id,
        priority: t.priority,
        status: 'todo' as const,
        due_date: t.dueDate ?? null,
        position: baseTs + i,
      }))

      const { data, error } = await ctx.supabase
        .from('tasks')
        .insert(rows)
        .select('id, title, project_id')
      if (error) throw error

      // Fire task.created automations for each (best-effort, fire-and-forget).
      for (const t of data ?? []) {
        const original = input.tasks.find(x => x.title === t.title && x.projectId === t.project_id)
        if (!original) continue
        void triggerAutomations(ctx.supabase, {
          trigger: 'task.created',
          org_id: ctx.me.org_id,
          task: {
            id: t.id,
            project_id: t.project_id,
            title: t.title,
            status: 'todo',
            priority: original.priority,
            assignee_id: original.assigneeId ?? null,
            due_date: original.dueDate ?? null,
            labels: [],
          },
        })
      }

      return { created: data?.length ?? 0, ids: (data ?? []).map(d => d.id) }
    }),
})
