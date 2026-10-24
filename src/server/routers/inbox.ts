import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { todayInTZ } from '@/lib/tz'
import { weekBounds, GUEST_HAT } from '@/lib/multiempresa'
import { visibleEmpresas } from '@/server/multiempresa'

type RawTask = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  workspace_id: string | null
  project: { id: string; name: string; code: string; workspace_id: string } | null
}

/** Pending tasks assigned to me, inside the active grupo, due by the end of this week (or earlier). */
async function myPending(ctx: Parameters<typeof visibleEmpresas>[0], sunday: string) {
  const q = ctx.supabase
    .from('tasks')
    .select('id, title, status, priority, due_date, workspace_id, project:projects!inner(id, name, code, workspace_id)')
    .eq('assignee_id', ctx.me.id)
    .in('project.workspace_id', ctx.workspaceIds)
    .not('status', 'in', '(done,canceled)')
    .order('due_date', { ascending: true })
    .limit(300)
  const { data, error } = await q.not('due_date', 'is', null).lte('due_date', sunday)
  if (error) throw error
  return (data ?? []) as unknown as RawTask[]
}

export const inboxRouter = createTRPCRouter({
  /** "Hoy": my tasks in three groups — late, today, rest of the week — across all my empresas. */
  today: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const today = todayInTZ(undefined, ctx.tz)
      const { sunday } = weekBounds(today)
      const [tasks, empresas, hats] = await Promise.all([
        myPending(ctx, sunday),
        visibleEmpresas(ctx),
        ctx.workspaceIds.length
          ? ctx.supabase
              .from('workspace_members')
              .select('workspace_id, position')
              .eq('user_id', ctx.me.id)
              .eq('is_active', true)
              .in('workspace_id', ctx.workspaceIds)
          : Promise.resolve({ data: [] }),
      ])
      const empresaById = new Map(empresas.map(e => [e.id, e]))
      const hatByWs = new Map((hats.data ?? []).map(h => [h.workspace_id, h.position]))

      const shape = (t: RawTask) => {
        const wsId = t.workspace_id ?? t.project?.workspace_id ?? null
        const empresa = wsId ? empresaById.get(wsId) : undefined
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.due_date,
          project: t.project ? { id: t.project.id, name: t.project.name } : null,
          workspace: empresa ? { id: empresa.id, name: empresa.name, color: empresa.color } : null,
          hat: wsId ? (hatByWs.get(wsId) ?? GUEST_HAT) : null,
        }
      }

      const late: ReturnType<typeof shape>[] = []
      const dueToday: ReturnType<typeof shape>[] = []
      const week: ReturnType<typeof shape>[] = []
      for (const t of tasks) {
        const item = shape(t)
        if (input?.workspaceId && item.workspace?.id !== input.workspaceId) continue
        if (!t.due_date) continue
        if (t.due_date < today) late.push(item)
        else if (t.due_date === today) dueToday.push(item)
        else week.push(item)
      }
      return { today, late, dueToday, week }
    }),

  /** Counters for the empresa chips and the "Hoy" badge. */
  counts: protectedProcedure.query(async ({ ctx }) => {
    const today = todayInTZ(undefined, ctx.tz)
    const { sunday } = weekBounds(today)
    const tasks = await myPending(ctx, sunday)
    const byWorkspace: Record<string, number> = {}
    let badge = 0
    for (const t of tasks) {
      const wsId = t.workspace_id ?? t.project?.workspace_id
      if (wsId) byWorkspace[wsId] = (byWorkspace[wsId] ?? 0) + 1
      if (t.due_date && t.due_date <= today) badge++
    }
    return { total: tasks.length, badge, byWorkspace }
  }),
})
