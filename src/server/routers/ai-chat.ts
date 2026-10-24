import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { todayInTZ } from '@/lib/tz'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { sendChatMessage } from '@/lib/gemini'
import { fenceUntrusted } from '@/lib/ai-json'
import { enforceRateLimit, gcBuckets } from '@/lib/rate-limit'
import { requireFeature } from '@/lib/plan-limits'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Per-project AI chat router.
 *
 * One conversation per (project × user). On every send:
 *   1. Append the user's message to the conversation
 *   2. Fetch project context (tasks, recent activity, comments, etc.)
 *   3. Build the prompt = system + project context + last N messages
 *   4. Call Gemini Flash, store the assistant reply, return both
 *
 * Multi-turn memory is the message log itself — we feed the last 20
 * messages back as conversation history on each call.
 */

const HISTORY_LIMIT = 20 // last N messages fed back to Gemini

async function getOrCreateConversation(
  supabase: SupabaseClient<Database>,
  projectId: string,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('ai_conversations')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('ai_conversations')
    .insert({ project_id: projectId, user_id: userId })
    .select('id')
    .single()
  if (error) throw error
  return created.id
}

/** Only projects the caller can see (membership / empresa visibility) — no reading others' projects by UUID. */
function assertProjectAccess(ctx: { projectIds: string[] }, projectId: string) {
  if (!ctx.projectIds.includes(projectId)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proyecto no encontrado.' })
}

export const aiChatRouter = createTRPCRouter({
  /** Load the conversation for the current user × project (creates if missing). */
  conversation: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertProjectAccess(ctx, input.projectId)
      const conversationId = await getOrCreateConversation(ctx.supabase, input.projectId, ctx.me.id)
      const { data: messages } = await ctx.supabase
        .from('ai_messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(200)
      return { conversationId, messages: messages ?? [] }
    }),

  /**
   * Send a user message, get the assistant reply.
   * Stores both messages in the DB. Returns the assistant reply.
   *
   * Failure modes handled:
   *   - Gemini timeout / API error → stores an assistant message "Sorry,
   *     I couldn't respond." so the chat history stays consistent.
   */
  send: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      message: z.string().min(1).max(4000),
    }))
    .mutation(async ({ ctx, input }) => {
      // Chat is the most likely to be rapid-fired by a curious user, so we
      // budget a bit more here than the other AI calls.
      assertProjectAccess(ctx, input.projectId)
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Chat con IA')
      enforceRateLimit(`${ctx.me.id}:aiChat`, { tokensPerMinute: 1, maxBurst: 15 })
      gcBuckets()
      const conversationId = await getOrCreateConversation(ctx.supabase, input.projectId, ctx.me.id)

      // 1. Append user's message FIRST so it shows up even if the AI call fails.
      const { data: userMsg, error: userErr } = await ctx.supabase
        .from('ai_messages')
        .insert({ conversation_id: conversationId, role: 'user', content: input.message })
        .select('id, role, content, created_at')
        .single()
      if (userErr) throw userErr

      // 2. Gather project context in parallel.
      const [{ data: project }, { data: tasks }, { data: history }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name, description, status, priority, start_date, end_date, progress_pct, budget, currency, health_score')
          .eq('id', input.projectId)
          .single(),
        ctx.supabase
          .from('tasks')
          .select('title, status, priority, due_date, assignee:users!tasks_assignee_id_fkey(name)')
          .eq('project_id', input.projectId)
          .is('parent_task_id', null)
          .order('updated_at', { ascending: false })
          .limit(40),
        ctx.supabase
          .from('ai_messages')
          .select('role, content')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(HISTORY_LIMIT),
      ])

      if (!project) throw new Error('Project not found')

      // 3. Build prompt
      const taskSummary = (tasks ?? []).map(t => {
        const assignee = (t.assignee as { name?: string } | null)?.name
        return `- [${t.status}] ${t.title}` +
          (t.priority ? ` (${t.priority})` : '') +
          (t.due_date ? ` · vence ${t.due_date}` : '') +
          (assignee ? ` · ${assignee}` : '')
      }).join('\n') || '(sin tareas)'

      const systemContext = `Eres un asistente de gestión de proyectos para FARO. Responde en español de manera concisa y accionable. Si te piden un análisis, devuelve bullets cortos. No inventes datos que no estén en el contexto.

CONTEXTO DEL PROYECTO:
- Código: ${project.code}
- Nombre: ${project.name}
- Status: ${project.status}, Prioridad: ${project.priority}
- Avance: ${project.progress_pct}%
- Salud: ${project.health_score ?? 'no calculada'}/100
- Fechas: ${project.start_date ?? '?'} → ${project.end_date ?? '?'}
- Presupuesto: ${project.budget ?? 'no definido'} ${project.currency ?? ''}
${fenceUntrusted('descripción del proyecto', project.description ?? '(sin descripción)')}

TAREAS DEL PROYECTO (${tasks?.length ?? 0}):
${fenceUntrusted('tareas del proyecto', taskSummary)}

Hoy es ${todayInTZ(undefined, ctx.tz)}.`

      // Last N messages in chronological order (history was fetched DESC),
      // excluding the just-inserted user message (that's `input.message`).
      const turns = [...(history ?? [])].reverse().slice(0, -1)

      // 4. Call Gemini with multi-turn format
      let replyText = ''
      try {
        replyText = (await sendChatMessage(turns, input.message, systemContext, { feature: 'ai-chat.send', orgId: ctx.activeOrg?.id })).trim()
      } catch (err) {
        console.warn('[ai-chat] gemini failed:', err)
        replyText = 'No se pudo generar una respuesta ahora. Intenta de nuevo en unos segundos.'
      }

      // 5. Persist assistant reply
      const { data: assistantMsg, error: aErr } = await ctx.supabase
        .from('ai_messages')
        .insert({ conversation_id: conversationId, role: 'assistant', content: replyText })
        .select('id, role, content, created_at')
        .single()
      if (aErr) throw aErr

      // 6. Touch conversation updated_at
      await ctx.supabase
        .from('ai_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)

      return { user: userMsg, assistant: assistantMsg }
    }),

  /** Clear the conversation for the current user × project. */
  reset: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: conv } = await ctx.supabase
        .from('ai_conversations')
        .select('id')
        .eq('project_id', input.projectId)
        .eq('user_id', ctx.me.id)
        .maybeSingle()
      if (conv) {
        await ctx.supabase.from('ai_messages').delete().eq('conversation_id', conv.id)
      }
      return { success: true }
    }),
})
