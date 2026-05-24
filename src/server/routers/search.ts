import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const searchRouter = createTRPCRouter({
  global: protectedProcedure
    .input(z.string().min(1).max(100))
    .query(async ({ ctx, input }) => {
      const { workspaceIds } = ctx
      if (!workspaceIds.length) return { projects: [], tasks: [] }

      const q = `%${input.trim()}%`

      // Search projects by name/code AND fetch all project IDs in parallel
      const [{ data: projects }, { data: allProjects }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name, status, color')
          .in('workspace_id', workspaceIds)
          .or(`name.ilike.${q},code.ilike.${q}`)
          .limit(6),
        ctx.supabase
          .from('projects')
          .select('id')
          .in('workspace_id', workspaceIds),
      ])

      const projectIds = allProjects?.map(p => p.id) ?? []

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
