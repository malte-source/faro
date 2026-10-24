import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { generateFlash } from '@/lib/gemini'
import { parseAiJson, fenceUntrusted } from '@/lib/ai-json'
import { taskCommentsSummarySchema, projectWeekSummarySchema } from '@/server/ai-schemas'
import { enforceRateLimit, gcBuckets } from '@/lib/rate-limit'
import { todayInTZ } from '@/lib/tz'
import { requireFeature } from '@/lib/plan-limits'

/**
 * AI-powered summarization helpers — TL;DRs for long content surfaces
 * where reading the raw is slow:
 *
 *   - summarizeTaskComments: collapses a long comment thread into
 *     "decisión / abiertas / próximos pasos". For tasks with 5+ comments.
 *   - summarizeProjectWeek: executive recap of project activity in the
 *     last 7 days — task moves, comments, completions, risks.
 *
 * Both return JSON-validated structured output (not free text) so the UI
 * can render them as cards instead of a paragraph.
 *
 * Cost: each call ≈ Gemini Flash with ≤3K input tokens. Cheap.
 */

export const aiSummarizeRouter = createTRPCRouter({
  /** Collapse a task's comment thread into a structured TL;DR. */
  summarizeTaskComments: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Resumen con IA')
      enforceRateLimit(`${ctx.me.id}:aiSummarize`)
      gcBuckets()

      // IDOR guard: task must be in caller's projects.
      const { data: task } = await ctx.supabase
        .from('tasks')
        .select('id, title, project_id')
        .eq('id', input.taskId)
        .in('project_id', ctx.projectIds)
        .single()
      if (!task) throw new TRPCError({ code: 'NOT_FOUND' })

      const { data: comments } = await ctx.supabase
        .from('task_comments')
        .select('content, created_at, author:users(name)')
        .eq('task_id', input.taskId)
        .order('created_at', { ascending: true })

      if (!comments || comments.length < 2) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Necesitas al menos 2 comentarios para que valga la pena resumir.',
        })
      }

      const transcript = comments
        .map(c => {
          const author = (c.author as { name?: string } | null)?.name ?? 'Alguien'
          const when = new Date(c.created_at).toLocaleDateString('es-AR')
          return `[${when}] ${author}: ${c.content}`
        })
        .join('\n')

      const prompt = `Tienes que sintetizar la conversación de un equipo PM sobre UNA tarea. Devuélveme JSON estricto, conciso, en español neutro latinoamericano.

CONVERSACIÓN (${comments.length} comentarios sobre la tarea "${task.title}"):
${fenceUntrusted('comentarios de la tarea', transcript.slice(0, 12_000))}

Devuelve SIN markdown:
{
  "tldr": "1-2 frases que captan lo central",
  "decisions": ["Decisión concreta tomada", "..."],
  "open_questions": ["Pregunta o tema abierto que falta resolver", "..."],
  "next_steps": ["Próxima acción concreta (incluye responsable si se mencionó)", "..."]
}

Si la conversación es pura conversación social sin contenido útil, devuelve arrays vacíos pero igual arma un tldr honesto ("la conversación no tuvo acuerdos concretos").
NO inventes. Si no hay decisiones explícitas, decisions=[]. Mismo criterio para los otros campos.`

      let parsed: { tldr: string; decisions: string[]; open_questions: string[]; next_steps: string[] }
      try {
        parsed = parseAiJson(
          await generateFlash(prompt, { feature: 'ai-summarize.taskComments', orgId: ctx.activeOrg?.id }),
          taskCommentsSummarySchema,
        )
      } catch (err) {
        console.error('[summarizeTaskComments] gemini failed', err)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudo generar el resumen. Reintenta.' })
      }

      return { ...parsed, comments_count: comments.length }
    }),

  /** Executive recap of a project's activity in the last 7 days. */
  summarizeProjectWeek: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Resumen con IA')
      enforceRateLimit(`${ctx.me.id}:aiSummarize`)
      gcBuckets()

      if (!ctx.projectIds.includes(input.projectId)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const today = todayInTZ(undefined, ctx.tz)
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

      const [{ data: project }, { data: tasks }, { data: comments }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('code, name, status, priority, end_date, progress_pct, health_score')
          .eq('id', input.projectId)
          .single(),
        ctx.supabase
          .from('tasks')
          .select('title, status, priority, due_date, updated_at, assignee:users!tasks_assignee_id_fkey(name)')
          .eq('project_id', input.projectId)
          .gte('updated_at', sevenDaysAgo)
          .order('updated_at', { ascending: false })
          .limit(60),
        ctx.supabase
          .from('task_comments')
          .select('content, created_at, task:tasks(title), author:users(name)')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(30),
      ])

      if (!project) throw new TRPCError({ code: 'NOT_FOUND' })

      // Filter comments to this project's tasks. We over-fetched because
      // there's no easy way to filter through `task.project_id` server-side
      // with a single Supabase query.
      const projectTaskIds = new Set((tasks ?? []).map(t => t.title))
      // We don't have task IDs in comments embedded — settle for "comments
      // mentioning tasks that moved" by title match; cheap heuristic.
      const relevantComments = (comments ?? []).filter(c => {
        const t = (c.task as { title?: string } | null)?.title
        return t && projectTaskIds.has(t)
      })

      if ((tasks ?? []).length === 0 && relevantComments.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Sin actividad en los últimos 7 días — nada que resumir.',
        })
      }

      const taskLog = (tasks ?? [])
        .map(t => {
          const assignee = (t.assignee as { name?: string } | null)?.name ?? '(sin asignar)'
          return `[${t.status}] ${t.title} · ${assignee}${t.due_date ? ` · vence ${t.due_date}` : ''}`
        })
        .join('\n')

      const commentLog = relevantComments
        .slice(0, 20)
        .map(c => {
          const author = (c.author as { name?: string } | null)?.name ?? 'Alguien'
          const taskTitle = (c.task as { title?: string } | null)?.title ?? '?'
          return `[${author} en "${taskTitle}"]: ${c.content.slice(0, 200)}`
        })
        .join('\n')

      const prompt = `Genera un RESUMEN EJECUTIVO de esta semana del proyecto, en JSON estricto, español neutro latinoamericano, conciso.

PROYECTO: [${project.code}] ${project.name}
Estado: ${project.status} · Prioridad: ${project.priority} · Progreso: ${project.progress_pct}% · Salud: ${project.health_score ?? '?'}/100
Vence: ${project.end_date ?? '—'}
Hoy: ${today}

TAREAS CON ACTIVIDAD ÚLTIMOS 7 DÍAS (${(tasks ?? []).length}):
${fenceUntrusted('tareas con actividad', taskLog || '(ninguna)')}

COMENTARIOS RECIENTES (${relevantComments.length}):
${fenceUntrusted('comentarios recientes', commentLog || '(ninguno)')}

Devuelve SIN markdown:
{
  "headline": "1 frase que captura lo más importante de la semana",
  "highlights": ["Logro o avance concreto", "..."],
  "risks": ["Riesgo, bloqueo o señal de alerta visible", "..."],
  "next_week": ["Foco para la próxima semana", "..."]
}

Sé honesto: si la semana fue tranquila, dilo. Si hay riesgos no resueltos (overdue, en revisión hace mucho), nómbralos. Máx 4 items por array.`

      let parsed: { headline: string; highlights: string[]; risks: string[]; next_week: string[] }
      try {
        parsed = parseAiJson(
          await generateFlash(prompt, { feature: 'ai-summarize.projectWeek', orgId: ctx.activeOrg?.id }),
          projectWeekSummarySchema,
        )
      } catch (err) {
        console.error('[summarizeProjectWeek] gemini failed', err)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudo generar el resumen.' })
      }

      return {
        ...parsed,
        tasks_count: (tasks ?? []).length,
        comments_count: relevantComments.length,
      }
    }),
})
