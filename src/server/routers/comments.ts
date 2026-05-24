import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

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
