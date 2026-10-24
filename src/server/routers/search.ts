import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const searchRouter = createTRPCRouter({
  global: protectedProcedure
    .input(z.string().min(1).max(100))
    .query(async ({ ctx, input }) => {
      // `ctx.projectIds` is already visibility-filtered (workspace/private/
      // personal per the caller's access) — searching against it instead of
      // the raw workspace project list prevents private/personal projects
      // (and their tasks) the caller has no access to from leaking into
      // search results.
      const { projectIds } = ctx
      if (!projectIds.length) return { projects: [], tasks: [] }

      const q = `%${input.trim()}%`

      const [{ data: projects }, { data: tasks }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name, status, color')
          .in('id', projectIds)
          .or(`name.ilike.${q},code.ilike.${q}`)
          .limit(6),
        ctx.supabase
          .from('tasks')
          .select('id, title, status, priority, project:projects(id, code, name, color)')
          .in('project_id', projectIds)
          .ilike('title', q)
          .neq('status', 'canceled')
          .limit(6),
      ])

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
