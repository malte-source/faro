import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const notificationsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { me, workspaceIds } = ctx

    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Run overdue tasks, due-soon tasks, and due projects in parallel
    const [{ data: overdueTasks }, { data: dueSoonTasks }, dueProjectsResult] = await Promise.all([
      // Overdue tasks assigned to me
      ctx.supabase
        .from('tasks')
        .select('id, title, due_date, project:projects(id, code, name, color)')
        .eq('assignee_id', me.id)
        .neq('status', 'done')
        .neq('status', 'canceled')
        .not('due_date', 'is', null)
        .lt('due_date', today)
        .order('due_date', { ascending: true })
        .limit(8),

      // Tasks due in next 3 days assigned to me
      ctx.supabase
        .from('tasks')
        .select('id, title, due_date, project:projects(id, code, name, color)')
        .eq('assignee_id', me.id)
        .neq('status', 'done')
        .neq('status', 'canceled')
        .gte('due_date', today)
        .lte('due_date', in3days)
        .order('due_date', { ascending: true })
        .limit(8),

      // Projects due in next 7 days (needs workspace IDs from context)
      workspaceIds.length
        ? ctx.supabase
            .from('projects')
            .select('id, code, name, color, end_date, status')
            .in('workspace_id', workspaceIds)
            .neq('status', 'completed')
            .neq('status', 'canceled')
            .not('end_date', 'is', null)
            .gte('end_date', today)
            .lte('end_date', in7days)
            .order('end_date', { ascending: true })
            .limit(5)
        : Promise.resolve({ data: [] }),
    ])

    const dueProjects = dueProjectsResult.data

    const totalCount =
      (overdueTasks?.length ?? 0) +
      (dueSoonTasks?.length ?? 0) +
      (dueProjects?.length ?? 0)

    return {
      overdueTasks: (overdueTasks ?? []) as Array<{
        id: string
        title: string
        due_date: string | null
        project: { id: string; code: string; name: string; color: string } | null
      }>,
      dueSoonTasks: (dueSoonTasks ?? []) as Array<{
        id: string
        title: string
        due_date: string | null
        project: { id: string; code: string; name: string; color: string } | null
      }>,
      dueProjects: (dueProjects ?? []) as Array<{
        id: string
        code: string
        name: string
        color: string
        end_date: string | null
        status: string
      }>,
      totalCount,
    }
  }),
})
