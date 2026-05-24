import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getFlashModel } from '@/lib/gemini'

async function logAudit(
  supabase: SupabaseClient<Database>,
  opts: {
    orgId: string
    entityType: string
    entityId: string
    action: string
    fieldChanged?: string
    oldValue?: string | null
    newValue?: string | null
    changedBy?: string
  }
) {
  await supabase.from('audit_log').insert({
    org_id: opts.orgId,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    action: opts.action,
    field_changed: opts.fieldChanged ?? null,
    old_value: opts.oldValue ?? null,
    new_value: opts.newValue ?? null,
    changed_by: opts.changedBy ?? null,
    source: 'app',
  })
}

const STATUS_ENUM = ['not_started', 'in_progress', 'on_hold', 'delayed', 'completed', 'canceled', 'pending'] as const
const KANBAN_ENUM = ['ideas', 'backlog', 'pending', 'in_progress', 'on_hold', 'completed', 'canceled'] as const
const PRIORITY_ENUM = ['very_high', 'high', 'medium', 'low', 'very_low'] as const

export const projectsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({
      workspaceId: z.string().optional(),
      status: z.enum(STATUS_ENUM).optional(),
      kanbanStage: z.enum(KANBAN_ENUM).optional(),
      departmentId: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { workspaceIds } = ctx
      if (!workspaceIds.length) return []

      let query = ctx.supabase
        .from('projects')
        .select(`
          *,
          department:departments(id, name, color),
          members:project_members(
            id, role,
            user:users(id, name, email, avatar_url)
          )
        `)
        .in('workspace_id', workspaceIds)
        .order('updated_at', { ascending: false })

      if (input?.status) query = query.eq('status', input.status)
      if (input?.kanbanStage) query = query.eq('kanban_stage', input.kanbanStage)
      if (input?.departmentId) query = query.eq('department_id', input.departmentId)

      const { data, error } = await query
      if (error) throw error
      return data
    }),

  byId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('projects')
        .select(`
          *,
          department:departments(id, name, color),
          members:project_members(
            id, role, joined_at,
            user:users(id, name, email, avatar_url, position)
          )
        `)
        .eq('id', input)
        .single()

      if (error) throw error
      return data
    }),

  create: protectedProcedure
    .input(z.object({
      workspaceId: z.string().optional(),
      code: z.string(),
      name: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(STATUS_ENUM).default('not_started'),
      kanbanStage: z.enum(KANBAN_ENUM).default('backlog'),
      priority: z.enum(PRIORITY_ENUM).default('medium'),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      estimatedHours: z.number().optional(),
      budget: z.number().optional(),
      currency: z.string().default('USD'),
      departmentId: z.string().optional(),
      color: z.string().default('#6366f1'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me, workspaceIds } = ctx

      const workspaceId = input.workspaceId ?? workspaceIds[0]
      if (!workspaceId) throw new Error('No workspace found')

      const { data, error } = await ctx.supabase
        .from('projects')
        .insert({
          workspace_id: workspaceId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          kanban_stage: input.kanbanStage,
          priority: input.priority,
          start_date: input.startDate ?? null,
          end_date: input.endDate ?? null,
          estimated_hours: input.estimatedHours ?? null,
          budget: input.budget ?? null,
          currency: input.currency,
          department_id: input.departmentId ?? null,
          color: input.color,
          progress_pct: 0,
          created_by: me.id,
        })
        .select()
        .single()

      if (error) throw error

      if (data) {
        await logAudit(ctx.supabase, {
          orgId: me.org_id,
          entityType: 'project',
          entityId: data.id,
          action: 'created',
          newValue: data.name,
          changedBy: me.id,
        })
      }

      return data
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      status: z.enum(STATUS_ENUM).optional(),
      kanbanStage: z.enum(KANBAN_ENUM).optional(),
      priority: z.enum(PRIORITY_ENUM).optional(),
      startDate: z.string().optional().nullable(),
      endDate: z.string().optional().nullable(),
      progressPct: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const { me } = ctx

      const { data: prev } = await ctx.supabase
        .from('projects').select('status, kanban_stage, progress_pct, name').eq('id', id).single()

      const { data, error } = await ctx.supabase
        .from('projects')
        .update({
          ...(rest.name && { name: rest.name }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.status && { status: rest.status }),
          ...(rest.kanbanStage && { kanban_stage: rest.kanbanStage }),
          ...(rest.priority && { priority: rest.priority }),
          ...(rest.startDate !== undefined && { start_date: rest.startDate }),
          ...(rest.endDate !== undefined && { end_date: rest.endDate }),
          ...(rest.progressPct !== undefined && { progress_pct: rest.progressPct }),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      if (me && prev && data) {
        const changes: { field: string; old: string; new: string }[] = []
        if (rest.status && rest.status !== prev.status) changes.push({ field: 'status', old: prev.status, new: rest.status })
        if (rest.kanbanStage && rest.kanbanStage !== prev.kanban_stage) changes.push({ field: 'kanban_stage', old: prev.kanban_stage, new: rest.kanbanStage })
        if (rest.progressPct !== undefined && rest.progressPct !== prev.progress_pct) changes.push({ field: 'progress_pct', old: String(prev.progress_pct), new: String(rest.progressPct) })

        for (const change of changes) {
          await logAudit(ctx.supabase, {
            orgId: me.org_id,
            entityType: 'project',
            entityId: id,
            action: 'updated',
            fieldChanged: change.field,
            oldValue: change.old,
            newValue: change.new,
            changedBy: me.id,
          })
        }
      }

      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx
      const { data: proj } = await ctx.supabase
        .from('projects').select('name').eq('id', input).single()

      const { error } = await ctx.supabase.from('projects').delete().eq('id', input)
      if (error) throw error

      if (me && proj) {
        await logAudit(ctx.supabase, {
          orgId: me.org_id,
          entityType: 'project',
          entityId: input,
          action: 'deleted',
          oldValue: proj.name,
          changedBy: me.id,
        })
      }

      return { success: true }
    }),

  computeHealth: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input: projectId }) => {
      const [{ data: project }, { data: tasks }] = await Promise.all([
        ctx.supabase.from('projects').select('status, end_date, progress_pct').eq('id', projectId).single(),
        ctx.supabase.from('tasks').select('status').eq('project_id', projectId),
      ])

      if (!project) throw new Error('Project not found')

      let score = 50

      if (project.status === 'completed') {
        score = 95
      } else if (project.status === 'canceled') {
        score = 20
      } else {
        const total = tasks?.length ?? 0
        const done = tasks?.filter(t => t.status === 'done').length ?? 0
        const taskScore = total > 0 ? (done / total) * 40 : 20

        const now = new Date()
        let dateScore = 20
        if (project.end_date) {
          const end = new Date(project.end_date)
          const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000)
          if (daysLeft < 0) dateScore = 0          // overdue
          else if (daysLeft <= 3) dateScore = 8    // critical
          else if (daysLeft <= 7) dateScore = 14   // warning
          else dateScore = 20                       // on track
        }

        let statusScore = 10
        if (project.status === 'delayed') statusScore = 0
        else if (project.status === 'on_hold') statusScore = 5
        else if (project.status === 'in_progress') statusScore = 10

        const progressScore = project.progress_pct >= 50 ? 20 : (project.progress_pct / 50) * 20

        score = Math.round(Math.min(100, Math.max(0, taskScore + dateScore + statusScore + progressScore)))
      }

      const { data, error } = await ctx.supabase
        .from('projects')
        .update({ health_score: score, health_updated_at: new Date().toISOString() })
        .eq('id', projectId)
        .select('id, health_score, health_updated_at')
        .single()

      if (error) throw error
      return data
    }),

  addMember: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      userId: z.string(),
      role: z.enum(['lead', 'contributor', 'viewer']).default('contributor'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx

      const { data, error } = await ctx.supabase
        .from('project_members')
        .insert({ project_id: input.projectId, user_id: input.userId, role: input.role, added_by: me.id })
        .select(`id, role, joined_at, user:users(id, name, email, avatar_url, position)`)
        .single()

      if (error) throw error
      return data
    }),

  removeMember: protectedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('project_members').delete().eq('id', input.memberId)
      if (error) throw error
      return { success: true }
    }),

  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const { workspaceIds } = ctx
    if (!workspaceIds.length) return { total: 0, active: 0, delayed: 0, completed: 0, onHold: 0, dueSoon: [], byStatus: {} }

    const { data: projects } = await ctx.supabase
      .from('projects')
      .select('id, code, name, status, kanban_stage, priority, end_date, health_score, progress_pct, color')
      .in('workspace_id', workspaceIds)

    if (!projects) return { total: 0, active: 0, delayed: 0, completed: 0, onHold: 0, dueSoon: [], byStatus: {} }

    const weekFromNow = new Date(Date.now() + 7 * 86400000)

    return {
      total: projects.length,
      active: projects.filter(p => p.status === 'in_progress').length,
      delayed: projects.filter(p => p.status === 'delayed').length,
      completed: projects.filter(p => p.status === 'completed').length,
      onHold: projects.filter(p => p.status === 'on_hold').length,
      dueSoon: projects.filter(p =>
        p.end_date && new Date(p.end_date) <= weekFromNow && p.status !== 'completed'
      ),
      byStatus: {
        not_started: projects.filter(p => p.status === 'not_started').length,
        in_progress: projects.filter(p => p.status === 'in_progress').length,
        on_hold: projects.filter(p => p.status === 'on_hold').length,
        delayed: projects.filter(p => p.status === 'delayed').length,
        completed: projects.filter(p => p.status === 'completed').length,
        canceled: projects.filter(p => p.status === 'canceled').length,
        pending: projects.filter(p => p.status === 'pending').length,
      },
    }
  }),

  aiInsight: protectedProcedure
    .input(z.string()) // projectId
    .mutation(async ({ ctx, input: projectId }) => {
      // Gather project context
      const [{ data: project }, { data: tasks }, { data: members }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name, description, status, priority, start_date, end_date, progress_pct, health_score, budget, currency')
          .eq('id', projectId)
          .single(),
        ctx.supabase
          .from('tasks')
          .select('id, title, status, priority, due_date, assignee_id')
          .eq('project_id', projectId)
          .is('parent_task_id', null),
        ctx.supabase
          .from('project_members')
          .select('id, role')
          .eq('project_id', projectId)
          .is('removed_at', null),
      ])

      if (!project) throw new Error('Project not found')

      const today = new Date()
      const endDate = project.end_date ? new Date(project.end_date) : null
      const daysLeft = endDate ? Math.ceil((endDate.getTime() - today.getTime()) / 86400000) : null

      const taskStats = {
        total: tasks?.length ?? 0,
        done: tasks?.filter(t => t.status === 'done').length ?? 0,
        in_progress: tasks?.filter(t => t.status === 'in_progress').length ?? 0,
        in_review: tasks?.filter(t => t.status === 'in_review').length ?? 0,
        todo: tasks?.filter(t => t.status === 'todo').length ?? 0,
        canceled: tasks?.filter(t => t.status === 'canceled').length ?? 0,
        overdue: tasks?.filter(t => t.due_date && new Date(t.due_date) < today && t.status !== 'done' && t.status !== 'canceled').length ?? 0,
        dueSoon: tasks?.filter(t => {
          if (!t.due_date || t.status === 'done' || t.status === 'canceled') return false
          const d = new Date(t.due_date)
          const diff = (d.getTime() - today.getTime()) / 86400000
          return diff >= 0 && diff <= 7
        }).length ?? 0,
        unassigned: tasks?.filter(t => !t.assignee_id && t.status !== 'done' && t.status !== 'canceled').length ?? 0,
      }

      const STATUS_ES: Record<string, string> = {
        not_started: 'No iniciado', in_progress: 'En progreso', on_hold: 'En pausa',
        delayed: 'Retrasado', completed: 'Completado', canceled: 'Cancelado', pending: 'Pendiente',
      }
      const PRIORITY_ES: Record<string, string> = {
        very_high: 'Muy alta', high: 'Alta', medium: 'Media', low: 'Baja', very_low: 'Muy baja',
      }

      const prompt = `Eres un experto en gestión de proyectos. Analiza el siguiente proyecto y proporciona un análisis ejecutivo conciso.

PROYECTO: ${project.name} (${project.code})
Estado: ${STATUS_ES[project.status] ?? project.status}
Prioridad: ${PRIORITY_ES[project.priority] ?? project.priority}
Salud: ${project.health_score != null ? `${project.health_score}%` : 'N/A'}
Progreso: ${project.progress_pct}%
${project.start_date ? `Inicio: ${project.start_date}` : ''}
${project.end_date ? `Vencimiento: ${project.end_date}${daysLeft !== null ? ` (${daysLeft > 0 ? `${daysLeft} días restantes` : `${Math.abs(daysLeft)} días vencido`})` : ''}` : ''}
${project.budget ? `Presupuesto: ${project.currency} ${project.budget}` : ''}
${project.description ? `Descripción: ${project.description}` : ''}

TAREAS (${taskStats.total} total):
- Completadas: ${taskStats.done}
- En progreso: ${taskStats.in_progress}
- En revisión: ${taskStats.in_review}
- Por hacer: ${taskStats.todo}
- Vencidas: ${taskStats.overdue}
- Vencen esta semana: ${taskStats.dueSoon}
- Sin asignar: ${taskStats.unassigned}

EQUIPO: ${members?.length ?? 0} integrantes

Responde ÚNICAMENTE con un JSON válido (sin markdown, sin texto adicional):
{
  "summary": "Resumen ejecutivo de 2-3 oraciones",
  "status_assessment": "Evaluación del estado actual en 1 oración",
  "risks": ["riesgo 1", "riesgo 2", "riesgo 3"],
  "recommendations": ["recomendación 1", "recomendación 2", "recomendación 3"],
  "next_steps": ["acción inmediata 1", "acción inmediata 2"]
}`

      const model = getFlashModel()
      const result = await model.generateContent(prompt)
      const text = result.response.text().trim()

      // Strip markdown code block if present
      const json = text.startsWith('```') ? text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '') : text

      const parsed = JSON.parse(json) as {
        summary: string
        status_assessment: string
        risks: string[]
        recommendations: string[]
        next_steps: string[]
      }

      return parsed
    }),
})
