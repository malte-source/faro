import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { todayInTZ } from '@/lib/tz'
import { generateFlash } from '@/lib/gemini'
import { parseAiJson, fenceUntrusted } from '@/lib/ai-json'
import { weeklyDigestSchema } from '@/server/ai-schemas'
import { limitsFor } from '@/lib/plan-limits'
import { enforceRateLimit, gcBuckets } from '@/lib/rate-limit'

/**
 * Weekly digest — Gemini summarises the state of the whole portfolio.
 *
 * Audience: org leads who want a 30-second read every Monday morning
 * instead of clicking through every project. Output is markdown so it
 * can be rendered inline AND copy-pasted into email / Google Chat.
 *
 * Returned shape mirrors what Gemini emits:
 *   { headline, highlights[], risks[], asks[], next_week_focus }
 *
 * Falls back to a deterministic template if Gemini fails so the user
 * always sees something useful.
 */
export const digestsRouter = createTRPCRouter({
  weekly: protectedProcedure.mutation(async ({ ctx }) => {
    // Looser limit — digest is genuinely an org-wide operation, not a
    // per-keystroke thing. 5/hour is plenty.
    enforceRateLimit(`${ctx.me.id}:weeklyDigest`, { tokensPerMinute: 0.08, maxBurst: 3 })
    gcBuckets()
    const { workspaceIds, me } = ctx
    if (!workspaceIds.length) {
      return {
        headline: 'No hay proyectos todavía.',
        highlights: [] as string[], risks: [] as string[], asks: [] as string[],
        next_week_focus: '',
        generated_at: new Date().toISOString(),
        ai_powered: false,
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

    // Gather portfolio context in parallel.
    const [{ data: projects }, { data: tasks }, { data: recentAudit }] = await Promise.all([
      ctx.supabase
        .from('projects')
        .select('id, code, name, status, priority, end_date, progress_pct, health_score')
        .in('workspace_id', workspaceIds)
        .limit(80),
      ctx.supabase
        .from('tasks')
        .select('title, status, priority, due_date, updated_at, project:projects(code)')
        .in('project_id', ctx.projectIds)
        .neq('status', 'done')
        .neq('status', 'canceled')
        .gte('updated_at', sevenDaysAgo)
        .order('updated_at', { ascending: false })
        .limit(50),
      ctx.supabase
        .from('audit_log')
        .select('entity_type, entity_id, action, field_changed, new_value, created_at')
        .eq('org_id', me.org_id)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    const allProjects = projects ?? []
    const overdueProjects = allProjects.filter(p =>
      p.end_date && new Date(p.end_date) < new Date() &&
      p.status !== 'completed' && p.status !== 'canceled',
    )
    const delayed = allProjects.filter(p => p.status === 'delayed')
    const dueThisWeek = allProjects.filter(p =>
      p.end_date && new Date(p.end_date) <= new Date(Date.now() + 7 * 86_400_000) &&
      p.status !== 'completed' && p.status !== 'canceled',
    )

    // Deterministic fallback in case Gemini fails or rate-limits us.
    const fallback = {
      headline: `${allProjects.length} proyectos · ${overdueProjects.length} vencidos · ${dueThisWeek.length} vencen esta semana`,
      highlights: [
        `${allProjects.filter(p => p.status === 'in_progress').length} proyectos en progreso.`,
        `${allProjects.filter(p => p.status === 'completed').length} proyectos completados en total.`,
        `${(tasks ?? []).length} tareas con actividad esta semana.`,
      ],
      risks: [
        ...overdueProjects.slice(0, 3).map(p => `${p.code} ${p.name} venció el ${p.end_date}.`),
        ...delayed.slice(0, 2).map(p => `${p.code} ${p.name} marcado como retrasado.`),
      ],
      asks: [],
      next_week_focus: dueThisWeek.length > 0
        ? `Cerrar entregables de: ${dueThisWeek.slice(0, 3).map(p => p.code).join(', ')}.`
        : 'Sin deadlines críticos la semana que viene.',
      generated_at: new Date().toISOString(),
      ai_powered: false,
    }

    // Build Gemini prompt
    const projectLines = allProjects.slice(0, 40).map(p =>
      `${p.code} | ${p.name} | ${p.status} | ${p.priority} | progreso ${p.progress_pct}% | salud ${p.health_score ?? '?'} | vence ${p.end_date ?? '—'}`
    ).join('\n')

    const taskLines = (tasks ?? []).slice(0, 30).map(t => {
      const proj = (t.project as { code: string } | null)
      return `[${t.status}] ${t.title}${proj ? ` (${proj.code})` : ''}${t.due_date ? ` · vence ${t.due_date}` : ''}`
    }).join('\n') || '(ninguna)'

    const auditCount = (recentAudit ?? []).length

    const prompt = `Eres el asistente ejecutivo de FARO. Genera un DIGEST SEMANAL del portfolio en formato JSON estricto, en español, conciso y accionable. Tono: ejecutivo, sin adornos.

Datos del portfolio (hoy ${todayInTZ(undefined, ctx.tz)}):

PROYECTOS (${allProjects.length}):
${fenceUntrusted('proyectos', projectLines || '(sin proyectos)')}

TAREAS CON ACTIVIDAD RECIENTE (${(tasks ?? []).length}):
${fenceUntrusted('tareas recientes', taskLines)}

EVENTOS DE AUDITORÍA ÚLTIMA SEMANA: ${auditCount}

Devuelve JSON con esta forma EXACTA (sin markdown, sin backticks):
{
  "headline": "<una línea ≤ 90 chars que resuma el estado general>",
  "highlights": ["<≤ 12 palabras>", "<≤ 12 palabras>", "<≤ 12 palabras>"],
  "risks": ["<riesgo concreto con nombre del proyecto, ≤ 15 palabras>", "..."],
  "asks": ["<acción pendiente que requiere decisión humana, ≤ 15 palabras>", "..."],
  "next_week_focus": "<una frase ≤ 25 palabras sobre dónde poner foco>"
}

Reglas:
- Menciona códigos de proyectos cuando sea relevante (ej: P-12, P-3).
- "asks" son cosas donde Faro necesita que un humano decida algo, no recordatorios.
- Si no hay datos suficientes para un campo, devuelve array vacío [] o string vacío.`

    // The AI digest is a plan feature; every other plan keeps the deterministic one (no error, no cost).
    if (!limitsFor(ctx.activeOrg?.plan).ai) return fallback

    try {
      const text = (await generateFlash(prompt, { feature: 'digests.weekly', orgId: ctx.activeOrg?.id })).trim()
      const parsed = parseAiJson(text, weeklyDigestSchema)
      return {
        headline: parsed.headline ?? fallback.headline,
        highlights: parsed.highlights,
        risks: parsed.risks,
        asks: parsed.asks,
        next_week_focus: parsed.next_week_focus ?? fallback.next_week_focus,
        generated_at: new Date().toISOString(),
        ai_powered: true,
      }
    } catch (err) {
      console.warn('[digest.weekly] Gemini failed:', err)
      return fallback
    }
  }),
})
