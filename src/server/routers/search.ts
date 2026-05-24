import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const searchRouter = createTRPCRouter({
  global: protectedProcedure
    .input(z.string().min(1).max(100))
    .query(async ({ ctx, input }) => {
      const { data: me } = await ctx.supabase
        .from('users')
        .select('id, org_id')
        .eq('email', ctx.session.user.email!)
        .single()
      if (!me) return { projects: [], tasks: [] }

      const q = `%${input.trim()}%`

      // Get workspace IDs for this org
      const { data: workspaces } = await ctx.supabase
        .from('workspaces')
        .select('id')
        .eq('org_id', me.org_id)
      const wsIds = workspaces?.map(w => w.id) ?? []
      if (!wsIds.length) return { projects: [], tasks: [] }

      // Search projects by name or code
      const { data: projects } = await ctx.supabase
        .from('projects')
        .select('id, code, name, status, color')
        .in('workspace_id', wsIds)
        .or(`name.ilike.${q},code.ilike.${q}`)
        .limit(6)

      // Get all project IDs for task search
      const { data: allProjects } = await ctx.supabase
        .from('projects')
        .select('id')
        .in('workspace_id', wsIds)
      const projectIds = allProjects?.map(p => p.id) ?? []

      // Search tasks by title
      const { data: tasks } = projectIds.length
        ? await ctx.supabase
            .from('tasks')
            .select('id, title, status, priority, project:projects(id, code, name, color)')
            .in('project_id', projectIds)
            .ilike('title', q)
            .neq('status', 'canceled')
            .limit(6)
        : { data: [] }

      return {
        projects: projects ?? [],
        tasks: (tasks ?? []) as Array<{
          id: string
          title: string
          status: string
          priority: string
          project: { id: string; code: string; name: string; color: string } | null
        }>,
      }
    }),
})
