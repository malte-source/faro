import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { postToChatWebhook } from '@/lib/google-chat'
import { isEnabled } from '@/server/routers/chat-notifications'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const APP_URL = process.env.AUTH_URL ?? 'https://faro-app-303070777698.southamerica-east1.run.app'

/**
 * Fire-and-forget: if the comment contains @mentions, push a Chat
 * notification to the org's Chat space so mentioned users see it without
 * needing to be inside FARO. Skipped silently if there's no webhook or
 * no mentions in the content.
 */
function notifyMentions(
  supabase: SupabaseClient<Database>,
  orgId: string,
  payload: {
    authorName: string
    taskId: string
    taskTitle: string
    projectId: string | null
    projectCode: string | null
    content: string
  },
) {
  // Cheap detection — only fire if the text actually has an @-token
  if (!/@\S/.test(payload.content)) return

  void (async () => {
    try {
      const { data: org } = await supabase
        .from('organizations')
        .select('google_chat_webhook_url, notification_prefs')
        .eq('id', orgId)
        .single()
      if (!org?.google_chat_webhook_url) return
      if (!isEnabled(org.notification_prefs as Record<string, boolean> | null, 'chat_mentions')) return

      // Strip excessive whitespace, cap at 400 chars for the card.
      const snippet = payload.content.length > 400
        ? payload.content.slice(0, 400) + '…'
        : payload.content

      const taskUrl = payload.projectId
        ? `${APP_URL}/dashboard/projects/${payload.projectId}`
        : `${APP_URL}/dashboard/tasks`

      await postToChatWebhook(org.google_chat_webhook_url, {
        cardsV2: [{
          cardId: `faro-mention-${payload.taskId}-${Date.now()}`,
          card: {
            header: {
              title: `💬 Mención de ${payload.authorName}`,
              subtitle: payload.projectCode
                ? `${payload.projectCode} · ${payload.taskTitle}`
                : payload.taskTitle,
            },
            sections: [{
              widgets: [
                { textParagraph: { text: snippet } },
                {
                  buttonList: {
                    buttons: [{
                      text: 'Ver tarea',
                      onClick: { openLink: { url: taskUrl } },
                    }],
                  },
                },
              ],
            }],
          },
        }],
      })
    } catch (err) {
      console.warn('[chat notify mention]', payload.taskId, err)
    }
  })()
}

export const commentsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.string()) // taskId
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('task_comments')
        .select('*, author:users(id, name, avatar_url)')
        .eq('task_id', input)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    }),

  add: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      content: z.string().min(1).max(5000).trim(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx
      const { data, error } = await ctx.supabase
        .from('task_comments')
        .insert({ task_id: input.taskId, author_id: me.id, content: input.content })
        .select('*, author:users(id, name, avatar_url)')
        .single()
      if (error) throw error

      // Fire-and-forget Chat notification when the comment has @mentions.
      // Look up the task to get project info for the card.
      void (async () => {
        const { data: task } = await ctx.supabase
          .from('tasks')
          .select('title, project:projects(id, code)')
          .eq('id', input.taskId)
          .single()
        if (!task) return
        const project = task.project as { id: string; code: string } | null
        notifyMentions(ctx.supabase, me.org_id, {
          authorName: ctx.session.user.name ?? ctx.session.user.email ?? 'Alguien',
          taskId: input.taskId,
          taskTitle: task.title,
          projectId: project?.id ?? null,
          projectCode: project?.code ?? null,
          content: input.content,
        })
      })()

      return data
    }),

  delete: protectedProcedure
    .input(z.string()) // commentId
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx
      // Can only delete own comments
      const { error } = await ctx.supabase
        .from('task_comments')
        .delete()
        .eq('id', input)
        .eq('author_id', me.id)
      if (error) throw error
      return { success: true }
    }),
})
