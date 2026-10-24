import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { generateFlash } from '@/lib/gemini'
import { parseAiJson, fenceUntrusted } from '@/lib/ai-json'
import { projectUpdateDraftSchema } from '@/server/ai-schemas'
import { enforceRateLimit, gcBuckets } from '@/lib/rate-limit'
import { requireFeature } from '@/lib/plan-limits'
import { todayInTZ } from '@/lib/tz'

const SENTIMENT_ENUM = ['positive', 'neutral', 'concern', 'blocker'] as const

/**
 * Project status updates — "posts" that surface a project's progress to
 * stakeholders. Each one has author + content + optional sentiment.
 *
 * `visible_in_share` controls whether external viewers (Share link) can see
 * the update. Internal-only updates (e.g. "Andes pidió descuento, hablamos
 * en privado") stay invisible to clients but visible to the team.
 *
 * Edit/delete: author OR org admin/owner.
 */
export const projectUpdatesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.projectIds.includes(input.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })
      const { data, error } = await ctx.supabase
        .from('project_updates')
        .select(`
          *,
          author:users!project_updates_author_id_fkey(id, name, avatar_url)
        `)
        .eq('project_id', input.projectId)
        .order('created_at', { ascending: false })
        .limit(input.limit)
      if (error) throw error
      return data ?? []
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      content: z.string().min(1).max(10_000),
      sentiment: z.enum(SENTIMENT_ENUM).optional(),
      visibleInShare: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.projectIds.includes(input.projectId)) throw new TRPCError({ code: 'FORBIDDEN' })
      const { data, error } = await ctx.supabase
        .from('project_updates')
        .insert({
          project_id: input.projectId,
          author_id: ctx.me.id,
          content: input.content.trim(),
          sentiment: input.sentiment ?? null,
          visible_in_share: input.visibleInShare,
        })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      content: z.string().min(1).max(10_000).optional(),
      sentiment: z.enum(SENTIMENT_ENUM).nullable().optional(),
      visibleInShare: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      const { data: existing } = await ctx.supabase
        .from('project_updates')
        .select('author_id, project_id')
        .eq('id', input.id)
        .single()
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!ctx.projectIds.includes(existing.project_id)) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!isAdmin && existing.author_id !== ctx.me.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el autor o admins pueden editar.' })
      }

      const { data, error } = await ctx.supabase
        .from('project_updates')
        .update({
          updated_at: new Date().toISOString(),
          ...(input.content !== undefined && { content: input.content.trim() }),
          ...(input.sentiment !== undefined && { sentiment: input.sentiment }),
          ...(input.visibleInShare !== undefined && { visible_in_share: input.visibleInShare }),
        })
        .eq('id', input.id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      const { data: existing } = await ctx.supabase
        .from('project_updates')
        .select('author_id, project_id')
        .eq('id', input)
        .single()
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!ctx.projectIds.includes(existing.project_id)) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!isAdmin && existing.author_id !== ctx.me.id) throw new TRPCError({ code: 'FORBIDDEN' })

      const { error } = await ctx.supabase.from('project_updates').delete().eq('id', input)
      if (error) throw error
      return { success: true }
    }),

  /**
   * AI-generated draft based on recent project activity. Author edits + posts.
   * Same prompt template as summarizeProjectWeek but framed as a 1st-person
   * update ("Esta semana avanzamos en X, surgió Y…").
   */
  generateDraft: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Generar actualización con IA')
      enforceRateLimit(`${ctx.me.id}:updateDraft`)
      gcBuckets()
      if (!ctx.projectIds.includes(input.projectId)) throw new TRPCError({ code: 'NOT_FOUND' })

      const today = todayInTZ(undefined, ctx.tz)
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

      const [{ data: project }, { data: tasks }, { data: lastUpdate }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('code, name, status, progress_pct, health_score, end_date')
          .eq('id', input.projectId)
          .single(),
        ctx.supabase
          .from('tasks')
          .select('title, status, priority, due_date, updated_at, assignee:users!tasks_assignee_id_fkey(name)')
          .eq('project_id', input.projectId)
          .gte('updated_at', sevenDaysAgo)
          .order('updated_at', { ascending: false })
          .limit(50),
        ctx.supabase
          .from('project_updates')
          .select('created_at, content')
          .eq('project_id', input.projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (!project) throw new TRPCError({ code: 'NOT_FOUND' })

      const taskLog = (tasks ?? [])
        .map(t => {
          const a = (t.assignee as { name?: string } | null)?.name ?? '—'
          return `[${t.status}] ${t.title} · ${a}${t.due_date ? ` · vence ${t.due_date}` : ''}`
        })
        .join('\n')

      const sinceLast = lastUpdate
        ? `Hubo un update previo el ${new Date(lastUpdate.created_at).toLocaleDateString('es-AR')}. NO repitas lo que ya estaba dicho ahí:\n${fenceUntrusted('update anterior', lastUpdate.content.slice(0, 1000))}`
        : 'Es el primer update del proyecto. Puedes incluir contexto inicial.'

      const prompt = `Genera un UPDATE DE STATUS para que el PM publique. Texto corto (3-6 oraciones), profesional, primera persona del plural ("avanzamos", "estamos"), español neutro latinoamericano. Honest pero positivo cuando corresponde, alerta cuando hay riesgo.

PROYECTO: [${project.code}] ${project.name}
Estado actual: ${project.status} · Progreso: ${project.progress_pct}% · Salud: ${project.health_score ?? '?'}/100
Vence: ${project.end_date ?? '—'} · Hoy: ${today}

ACTIVIDAD ÚLTIMOS 7 DÍAS (${(tasks ?? []).length} tareas con movimiento):
${fenceUntrusted('tareas con movimiento', taskLog || '(ninguna)')}

${sinceLast}

Devuelve SOLO un objeto JSON sin markdown:
{
  "content": "El texto del update tal como lo va a leer un stakeholder. Sin emojis excesivos, sin viñetas largas. Como un párrafo conciso.",
  "suggested_sentiment": "positive | neutral | concern | blocker"
}

El sentiment lo elegís en base al tono real: si hay overdue o stuck, "concern"; si hay un bloqueador, "blocker"; si todo va OK, "positive"; default "neutral".`

      let parsed: { content: string; suggested_sentiment: string }
      try {
        parsed = parseAiJson(
          await generateFlash(prompt, { feature: 'project-updates.generateDraft', orgId: ctx.activeOrg?.id }),
          projectUpdateDraftSchema,
        )
      } catch (err) {
        console.error('[updates.generateDraft] gemini failed', err)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudo generar el draft.' })
      }
      const sentiment = SENTIMENT_ENUM.includes(parsed.suggested_sentiment as typeof SENTIMENT_ENUM[number])
        ? parsed.suggested_sentiment as typeof SENTIMENT_ENUM[number]
        : 'neutral'
      return {
        content: String(parsed.content ?? '').slice(0, 5000),
        suggested_sentiment: sentiment,
      }
    }),
})
