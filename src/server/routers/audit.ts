import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const auditRouter = createTRPCRouter({
  byProject: protectedProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('audit_log')
        .select(`
          id, entity_type, entity_id, action, field_changed,
          old_value, new_value, changed_at, source,
          user:users!audit_log_changed_by_fkey(id, name, avatar_url)
        `)
        .eq('entity_id', input.projectId)
        .order('changed_at', { ascending: false })
        .limit(input.limit)

      if (error) throw error
      return data ?? []
    }),

  byOrg: protectedProcedure
    .input(z.object({ limit: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const { data: me } = await ctx.supabase
        .from('users').select('org_id').eq('email', ctx.session.user.email!).single()
      if (!me) return []

      const { data, error } = await ctx.supabase
        .from('audit_log')
        .select(`
          id, entity_type, entity_id, action, field_changed,
          old_value, new_value, changed_at, source,
          user:users!audit_log_changed_by_fkey(id, name, avatar_url)
        `)
        .eq('org_id', me.org_id)
        .order('changed_at', { ascending: false })
        .limit(input?.limit ?? 30)

      if (error) throw error
      return data ?? []
    }),
})
