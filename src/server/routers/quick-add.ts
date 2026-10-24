import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { todayInTZ } from '@/lib/tz'
import { parseQuickAdd } from '@/lib/multiempresa'
import { ensureInboxProject, loadPeople, visibleEmpresas } from '@/server/multiempresa'
import { triggerAutomations } from '@/lib/automations'

/**
 * Create a task in one line: "Pagar proveedores #mesa @andy viernes".
 * The same parser runs in the client for the live "Faro entiende:" preview;
 * the server re-parses and validates, never trusting the client's reading.
 */
export const quickAddRouter = createTRPCRouter({
  parse: protectedProcedure
    .input(z.object({ text: z.string().max(500), filterWorkspaceId: z.string().uuid().nullish() }))
    .query(async ({ ctx, input }) => {
      const [workspaces, people] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
      return parseQuickAdd(input.text, {
        today: todayInTZ(undefined, ctx.tz),
        people,
        workspaces,
        filterWorkspaceId: input.filterWorkspaceId,
        defaultAssigneeId: ctx.me.id,
      })
    }),

  create: protectedProcedure
    .input(z.object({ text: z.string().min(1).max(500), filterWorkspaceId: z.string().uuid().nullish() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
      const [workspaces, people] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
      const parsed = parseQuickAdd(input.text, {
        today: todayInTZ(undefined, ctx.tz),
        people,
        workspaces,
        filterWorkspaceId: input.filterWorkspaceId,
        defaultAssigneeId: ctx.me.id,
      })

      if (!parsed.title) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Escribe qué hay que hacer.' })
      const workspaceId = parsed.workspaceId ?? (workspaces.length === 1 ? workspaces[0].id : null)
      if (!workspaceId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Indica la empresa con #nombre (ej: #mesa).' })
      }
      if (!workspaces.some(w => w.id === workspaceId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a esa empresa.' })
      }

      const projectId = await ensureInboxProject(
        { ...ctx, activeOrg: ctx.activeOrg },
        workspaceId,
        parsed.assigneeId ? [parsed.assigneeId] : [],
      )

      const { data, error } = await ctx.supabase
        .from('tasks')
        .insert({
          project_id: projectId,
          workspace_id: workspaceId,
          title: parsed.title,
          assignee_id: parsed.assigneeId,
          reporter_id: ctx.me.id,
          priority: 'medium',
          status: 'todo',
          due_date: parsed.dueDate,
          position: Date.now(),
        })
        .select('id, project_id, title, status, priority, assignee_id, due_date, labels')
        .single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      void triggerAutomations(ctx.supabase, {
        trigger: 'task.created',
        org_id: ctx.me.org_id,
        task: {
          id: data.id,
          project_id: data.project_id,
          title: data.title,
          status: data.status,
          priority: data.priority,
          assignee_id: data.assignee_id,
          due_date: data.due_date,
          labels: data.labels ?? [],
        },
      })

      return { task: data, parsed: { ...parsed, workspaceId } }
    }),
})
