import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

/**
 * Workspaces inside the caller's org. Currently most orgs have a single
 * workspace ("default"); this list is mostly used as a destination picker
 * for cross-cutting actions (sheet import, mass moves, etc.).
 */
export const workspacesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('workspaces')
      .select('id, name')
      .eq('org_id', ctx.me.org_id)
      .order('name', { ascending: true })
    if (error) throw error
    return data ?? []
  }),
})
