import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { projectTaskAggregates } from '@/server/aggregates'
import { todayInTZ } from '@/lib/tz'
import { createTRPCRouter, protectedProcedure, invalidateCtxCache } from '@/lib/trpc/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { generateFlash } from '@/lib/gemini'
import { parseAiJson } from '@/lib/ai-json'
import { requireFeature } from '@/lib/plan-limits'
import { projectInsightSchema } from '@/server/ai-schemas'
import { enforceRateLimit, gcBuckets } from '@/lib/rate-limit'
import {
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  projectToCalendarEvent,
} from '@/lib/google-calendar'
import {
  createDriveFolder, listDriveFolderFiles, getDriveFolder,
} from '@/lib/google-drive'
import { postToChatWebhook, newProjectCard } from '@/lib/google-chat'
import { isEnabled } from '@/server/routers/chat-notifications'

const APP_URL = process.env.AUTH_URL ?? 'https://faro-app-303070777698.southamerica-east1.run.app'

/**
 * Fire-and-forget Google Chat notification for project creation.
 * Reads the org's webhook URL from DB; silently skips if none configured.
 */
function notifyChatNewProject(
  supabase: SupabaseClient<Database>,
  me: { id: string; org_id: string },
  project: { id: string; code: string; name: string; status: string; priority: string; end_date: string | null },
) {
  void (async () => {
    try {
      const [{ data: org }, { data: user }] = await Promise.all([
        supabase.from('organizations').select('google_chat_webhook_url, notification_prefs').eq('id', me.org_id).single(),
        supabase.from('users').select('name').eq('id', me.id).single(),
      ])
      const url = org?.google_chat_webhook_url
      if (!url) return // no webhook configured — silent skip
      if (!isEnabled(org?.notification_prefs as Record<string, boolean> | null, 'chat_new_project')) return
      await postToChatWebhook(url, newProjectCard({
        code: project.code,
        name: project.name,
        status: project.status,
        priority: project.priority,
        createdBy: user?.name ?? 'Alguien',
        endDate: project.end_date,
        url: `${APP_URL}/dashboard/projects/${project.id}`,
      }))
    } catch (err) {
      console.warn('[chat notify newProject]', project.code, err)
    }
  })()
}

/**
 * Fire-and-forget Google Calendar sync — never awaited.
 * If the user has a valid access_token and the project has both dates,
 * create/update/delete an event on their primary calendar.
 */
function syncCalendarEvent(
  supabase: SupabaseClient<Database>,
  opts: {
    action: 'create' | 'update' | 'delete'
    accessToken: string | undefined
    project: {
      id: string
      code: string
      name: string
      description?: string | null
      start_date: string | null
      end_date: string | null
      google_calendar_event_id: string | null
    }
  },
) {
  const { action, accessToken, project } = opts
  if (!accessToken) return
  void (async () => {
    try {
      if (action === 'delete' && project.google_calendar_event_id) {
        await deleteCalendarEvent(accessToken, project.google_calendar_event_id)
        return
      }
      if (action === 'delete') return // no event to delete

      // create/update branches both require both dates
      if (!project.start_date || !project.end_date) {
        // If the event existed before but dates were cleared, delete it.
        if (project.google_calendar_event_id) {
          await deleteCalendarEvent(accessToken, project.google_calendar_event_id)
          await supabase
            .from('projects')
            .update({ google_calendar_event_id: null })
            .eq('id', project.id)
        }
        return
      }

      const payload = projectToCalendarEvent({
        ...project,
        start_date: project.start_date,
        end_date: project.end_date,
        appUrl: APP_URL,
      })

      if (project.google_calendar_event_id) {
        await updateCalendarEvent(accessToken, project.google_calendar_event_id, payload)
      } else {
        const ev = await createCalendarEvent(accessToken, payload)
        await supabase
          .from('projects')
          .update({ google_calendar_event_id: ev.id })
          .eq('id', project.id)
      }
    } catch (err) {
      console.warn('[calendar sync]', action, project.code, err)
    }
  })()
}

/**
 * Fire-and-forget audit helper.
 * Never awaited — audit writes are not on the critical path for the user response.
 * Errors are silently swallowed (audit loss is acceptable vs slowing the UX).
 */
function logAudit(
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
  void supabase.from('audit_log').insert({
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
      // 'mine' = membership-filtered (default for everyone)
      // 'all'  = whole org — only effective for owner/admin; for others falls back to 'mine'
      scope: z.enum(['mine', 'all']).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { allOrgProjectIds, myMembershipIds, me } = ctx
      const isAdmin = me.role === 'owner' || me.role === 'admin'
      // Default: 'mine' (memberships only). Admins can request 'all' (whole org).
      // Non-admins always see their memberships regardless of scope.
      const wantsAll = input?.scope === 'all' && isAdmin
      // Grupo mode (workspace-scoped visibility): Dirección sees every project
      // of the grupo, everyone else every project of their empresas (ctx.projectIds
      // already folds in shared projects). The mine/all toggle doesn't apply.
      const targetIds = ctx.activeOrg?.workspace_scoped
        ? (isAdmin ? allOrgProjectIds : ctx.projectIds)
        : (wantsAll ? allOrgProjectIds : myMembershipIds)
      if (!targetIds.length) return []

      let query = ctx.supabase
        .from('projects')
        .select(`
          *,
          department:departments(id, name, color),
          members:project_members(
            id, role,
            user:users!project_members_user_id_fkey(id, name, email, avatar_url)
          ),
          shared:project_workspaces(workspace_id)
        `)
        .in('id', targetIds)
        .order('updated_at', { ascending: false })

      if (input?.workspaceId) query = query.eq('workspace_id', input.workspaceId)
      if (input?.status) query = query.eq('status', input.status)
      if (input?.kanbanStage) query = query.eq('kanban_stage', input.kanbanStage)
      if (input?.departmentId) query = query.eq('department_id', input.departmentId)

      const { data, error } = await query
      if (error) throw error
      const projects = data ?? []
      if (!projects.length) return []

      // Enrich each project with task counts + last activity: counted in SQL (rpc, ids in the
      // request body, no 1,000-row truncation); see src/server/aggregates.ts for the fallback.
      const projectIdList = projects.map(p => p.id)
      const aggByProject = await projectTaskAggregates(ctx.supabase, projectIdList)

      // Empresa (name + color) of each project and the empresas it is shared with.
      const { data: empresaRows } = await ctx.supabase
        .from('workspaces')
        .select('id, name, color')
        .in('id', ctx.workspaceIds)
      const empresaById = new Map((empresaRows ?? []).map(w => [w.id, w]))

      return projects.map(p => {
        const agg = aggByProject.get(p.id) ?? { total: 0, done: 0, lastActivity: null }
        const empresa = empresaById.get(p.workspace_id)
        const sharedWith = ((p as unknown as { shared: Array<{ workspace_id: string }> | null }).shared ?? [])
          .map(s => empresaById.get(s.workspace_id))
          .filter((w): w is NonNullable<typeof w> => !!w)
        // last_activity = max(project.updated_at, max(task.updated_at))
        const last = [p.updated_at, agg.lastActivity].filter(Boolean).sort().pop() ?? p.updated_at
        return {
          ...p,
          _taskTotal: agg.total,
          _taskDone: agg.done,
          _lastActivity: last,
          _empresa: empresa ? { id: empresa.id, name: empresa.name, color: empresa.color } : null,
          _sharedWith: sharedWith.map(w => ({ id: w.id, name: w.name })),
        }
      })
    }),

  /**
   * Generate or rotate the email-to-task inbound token for a project.
   * Anyone who knew the previous URL loses access. Pair with the receiver
   * at /api/email/inbound/[token]. Returns the new token.
   */
  regenerateInboundToken: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.projectIds.includes(input.projectId)) throw new Error('Sin acceso al proyecto.')
      const { randomBytes } = await import('crypto')
      const token = randomBytes(18).toString('base64url')
      const { data, error } = await ctx.supabase
        .from('projects')
        .update({ inbound_token: token })
        .eq('id', input.projectId)
        .select('inbound_token')
        .single()
      if (error) throw error
      return { inbound_token: data.inbound_token! }
    }),

  /** Disable email-to-task for a project (clears the token). */
  disableInbound: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.projectIds.includes(input.projectId)) throw new Error('Sin acceso al proyecto.')
      const { error } = await ctx.supabase
        .from('projects').update({ inbound_token: null }).eq('id', input.projectId)
      if (error) throw error
      return { success: true }
    }),

  /** Recent inbound emails for a project. */
  inboundEmails: protectedProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.projectIds.includes(input.projectId)) throw new Error('Sin acceso al proyecto.')
      const { data, error } = await ctx.supabase
        .from('inbound_emails')
        .select(`
          *,
          task:tasks!inbound_emails_created_task_id_fkey(id, title, status)
        `)
        .eq('project_id', input.projectId)
        .order('received_at', { ascending: false })
        .limit(input.limit)
      if (error) throw error
      return data ?? []
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
            user:users!project_members_user_id_fkey(id, name, email, avatar_url, position)
          )
        `)
        .eq('id', input)
        .single()

      if (error) throw error
      return data
    }),

  /** Flattened export of projects (for CSV download client-side). */
  exportRows: protectedProcedure.query(async ({ ctx }) => {
    const { projectIds } = ctx
    if (!projectIds.length) return []
    const { data } = await ctx.supabase
      .from('projects')
      .select(`
        code, name, status, priority, kanban_stage, health_score,
        start_date, end_date, budget, created_at,
        department:departments(name),
        members:project_members(role, user:users!project_members_user_id_fkey(name))
      `)
      .in('id', projectIds)
      .order('updated_at', { ascending: false })

    return (data ?? []).map(p => {
      const dept = p.department as { name?: string } | null
      const members = (p.members ?? []) as Array<{ role: string; user: { name?: string } | null }>
      const lead = members.find(m => m.role === 'lead')?.user?.name ?? ''
      return {
        codigo: p.code,
        nombre: p.name,
        estado: p.status,
        prioridad: p.priority,
        etapa: p.kanban_stage,
        salud: p.health_score != null ? String(p.health_score) : '',
        lead,
        equipo: members.map(m => m.user?.name ?? '').filter(Boolean).join(', '),
        departamento: dept?.name ?? '',
        inicio: p.start_date ?? '',
        fin: p.end_date ?? '',
        presupuesto: p.budget != null ? String(p.budget) : '',
        creado: p.created_at?.split('T')[0] ?? '',
      }
    })
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
      visibility: z.enum(['workspace', 'private', 'personal']).default('workspace'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me, workspaceIds, activeOrg } = ctx

      const workspaceId = input.workspaceId ?? workspaceIds[0]
      if (!workspaceId) throw new Error('No workspace found')
      if (!workspaceIds.includes(workspaceId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Esa empresa no es parte de tu grupo.' })
      }
      const isAdminRole = me.role === 'owner' || me.role === 'admin'
      if (activeOrg?.workspace_scoped && !isAdminRole && !ctx.myWorkspaceIds.includes(workspaceId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo puedes crear proyectos en las empresas donde tienes cargo.' })
      }
      if (input.code.trim().toUpperCase() === 'BANDEJA') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'El código BANDEJA está reservado.' })
      }

      // Plan limit: free workspaces capped at 5 projects total.
      // Counts all visibilities — personal projects also count against the cap
      // because they still consume storage / index / sync budget.
      if (activeOrg?.plan === 'free') {
        const { count } = await ctx.supabase
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .in('workspace_id', workspaceIds)
        if ((count ?? 0) >= 5) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Llegaste al límite de 5 proyectos del plan Free. Crea un workspace de Equipo para tener proyectos ilimitados.',
          })
        }
      }

      // Personal workspaces can only host personal projects — there's no
      // "workspace" visibility when you're alone. Coerce so the UI doesn't
      // have to guard.
      const visibility = activeOrg?.workspace_type === 'personal' ? 'personal' : input.visibility

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
          visibility,
          created_by: me.id,
        })
        .select()
        .single()

      if (error) throw error

      if (data) {
        // Auto-add the creator as `lead` member so visibility filtering
        // (project_members-based) lets them see their own project from
        // the first request. Fire-and-forget; failure here doesn't break
        // project creation (admin still sees it via the role bypass).
        void ctx.supabase
          .from('project_members')
          .insert({ project_id: data.id, user_id: me.id, role: 'lead', added_by: me.id })
          .then(({ error }) => { if (error) console.warn('[projects.create] auto-membership:', error.message) })

        // Bust ctx cache so the new project appears in task filters immediately
        invalidateCtxCache(ctx.session.user.email!)
        logAudit(ctx.supabase, {
          orgId: me.org_id,
          entityType: 'project',
          entityId: data.id,
          action: 'created',
          newValue: data.name,
          changedBy: me.id,
        })
        // Fire-and-forget: create Calendar event if dates are set
        syncCalendarEvent(ctx.supabase, {
          action: 'create',
          accessToken: ctx.session.accessToken,
          project: data,
        })
        // Fire-and-forget: notify Google Chat if a webhook is configured
        notifyChatNewProject(ctx.supabase, me, data)
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
      notebooklmId: z.string().nullable().optional(),
      goalId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const { me } = ctx

      // Single DB round-trip — no pre-fetch of prev values.
      // Audit logs are fire-and-forget and record the new value only.
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
          ...(rest.notebooklmId !== undefined && { notebooklm_notebook_id: rest.notebooklmId }),
          ...(rest.goalId !== undefined && { goal_id: rest.goalId }),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      // Fire-and-forget audit for explicitly changed fields
      if (me && data) {
        if (rest.status) logAudit(ctx.supabase, { orgId: me.org_id, entityType: 'project', entityId: id, action: 'updated', fieldChanged: 'status', newValue: rest.status, changedBy: me.id })
        if (rest.kanbanStage) logAudit(ctx.supabase, { orgId: me.org_id, entityType: 'project', entityId: id, action: 'updated', fieldChanged: 'kanban_stage', newValue: rest.kanbanStage, changedBy: me.id })
        if (rest.progressPct !== undefined) logAudit(ctx.supabase, { orgId: me.org_id, entityType: 'project', entityId: id, action: 'updated', fieldChanged: 'progress_pct', newValue: String(rest.progressPct), changedBy: me.id })
      }

      // Sync Calendar event if dates, name, or description changed
      if (data && (
        rest.startDate !== undefined ||
        rest.endDate !== undefined ||
        rest.name !== undefined ||
        rest.description !== undefined
      )) {
        syncCalendarEvent(ctx.supabase, {
          action: 'update',
          accessToken: ctx.session.accessToken,
          project: data,
        })
      }

      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx
      // Pre-fetch event ID so we can clean up Calendar after the row is gone.
      const { data: proj } = await ctx.supabase
        .from('projects')
        .select('id, code, name, description, start_date, end_date, google_calendar_event_id')
        .eq('id', input)
        .single()

      const { error } = await ctx.supabase.from('projects').delete().eq('id', input)
      if (error) throw error

      if (me && proj) {
        invalidateCtxCache(ctx.session.user.email!)
        logAudit(ctx.supabase, {
          orgId: me.org_id,
          entityType: 'project',
          entityId: input,
          action: 'deleted',
          oldValue: proj.name,
          changedBy: me.id,
        })
        // Clean up the Calendar event too — fire-and-forget
        if (proj.google_calendar_event_id) {
          syncCalendarEvent(ctx.supabase, {
            action: 'delete',
            accessToken: ctx.session.accessToken,
            project: proj,
          })
        }
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

      // IDOR: only allow adding members to projects we can already see.
      // (Admins see all; non-admins only their memberships.)
      if (!ctx.allOrgProjectIds.includes(input.projectId)) {
        throw new Error('No autorizado.')
      }

      const { data, error } = await ctx.supabase
        .from('project_members')
        .insert({ project_id: input.projectId, user_id: input.userId, role: input.role, added_by: me.id })
        .select(`id, role, joined_at, user:users!project_members_user_id_fkey(id, name, email, avatar_url, position)`)
        .single()

      if (error) throw error

      // Bust the ADDED user's ctx cache so they see the project on their
      // next request without waiting for the 5-min TTL.
      const { data: added } = await ctx.supabase.from('users').select('email').eq('id', input.userId).single()
      if (added?.email) invalidateCtxCache(added.email)
      return data
    }),

  removeMember: protectedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Pre-fetch the affected user's email so we can bust their cache after delete.
      const { data: row } = await ctx.supabase
        .from('project_members')
        .select('user:users!project_members_user_id_fkey(email)')
        .eq('id', input.memberId)
        .maybeSingle()
      const removedEmail = (row?.user as { email?: string } | null)?.email

      const { error } = await ctx.supabase.from('project_members').delete().eq('id', input.memberId)
      if (error) throw error
      if (removedEmail) invalidateCtxCache(removedEmail)
      return { success: true }
    }),

  /** Set a single custom field value on a project (merges into JSONB). */
  setCustomFieldValue: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      key: z.string(),
      value: z.union([z.string(), z.number(), z.null()]),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: project } = await ctx.supabase
        .from('projects').select('custom_fields, workspace_id').eq('id', input.projectId).single()
      if (!project || !ctx.workspaceIds.includes(project.workspace_id)) {
        throw new Error('No autorizado.')
      }
      const merged = { ...(project.custom_fields ?? {}), [input.key]: input.value }
      const { error } = await ctx.supabase
        .from('projects').update({ custom_fields: merged }).eq('id', input.projectId)
      if (error) throw error
      return { success: true }
    }),

  // ── Google Drive integration ──────────────────────────────────────────

  /**
   * Create a brand-new Drive folder named after the project and store its
   * id on `projects.google_drive_folder_id`. The user becomes the owner.
   */
  createDriveFolder: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new Error('No Google access token — please sign in again.')

      const { data: project, error: pErr } = await ctx.supabase
        .from('projects').select('id, code, name').eq('id', input.projectId).single()
      if (pErr || !project) throw new Error('Project not found')

      const folder = await createDriveFolder(accessToken, `FARO · ${project.code} ${project.name}`)
      await ctx.supabase
        .from('projects')
        .update({ google_drive_folder_id: folder.id })
        .eq('id', input.projectId)

      return folder
    }),

  /**
   * Link an existing Drive folder by its ID (from the Drive Picker on the
   * client, or pasted manually). Stores the id on the project row.
   */
  linkDriveFolder: protectedProcedure
    .input(z.object({ projectId: z.string(), folderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new Error('No Google access token — please sign in again.')

      // Verify the folder exists / is accessible before saving.
      const folder = await getDriveFolder(accessToken, input.folderId)
      if (!folder) throw new Error('Folder not found or not accessible to your account.')

      const { error } = await ctx.supabase
        .from('projects')
        .update({ google_drive_folder_id: folder.id })
        .eq('id', input.projectId)
      if (error) throw error
      return folder
    }),

  unlinkDriveFolder: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from('projects')
        .update({ google_drive_folder_id: null })
        .eq('id', input.projectId)
      if (error) throw error
      return { success: true }
    }),

  /**
   * List files inside the project's linked Drive folder.
   * Returns { folder: { id, name, webViewLink }, files: [...] }.
   * Returns { folder: null, files: [] } when the project has no folder linked.
   */
  driveFiles: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) return { folder: null, files: [] as const }

      const { data: project } = await ctx.supabase
        .from('projects').select('google_drive_folder_id').eq('id', input.projectId).single()
      const folderId = project?.google_drive_folder_id
      if (!folderId) return { folder: null, files: [] as const }

      const [folder, files] = await Promise.all([
        getDriveFolder(accessToken, folderId),
        listDriveFolderFiles(accessToken, folderId),
      ])
      return { folder, files }
    }),

  /**
   * Burn-down data for a project: a series of (date, totalTasks, doneTasks)
   * points across the project's lifetime. Used by the burn-down chart.
   *
   * We reconstruct history from `tasks.created_at` + `tasks.updated_at` —
   * imperfect (an undone+redone task is counted once) but good enough
   * without writing a full event sourcing layer.
   */
  burndown: protectedProcedure
    .input(z.string()) // projectId
    .query(async ({ ctx, input: projectId }) => {
      if (!ctx.projectIds.includes(projectId)) {
        return { points: [], start: null, end: null }
      }

      const [{ data: project }, { data: tasks }] = await Promise.all([
        ctx.supabase.from('projects').select('start_date, end_date, created_at').eq('id', projectId).single(),
        ctx.supabase.from('tasks').select('status, created_at, updated_at').eq('project_id', projectId),
      ])
      if (!project) return { points: [], start: null, end: null }

      const start = project.start_date ?? project.created_at.split('T')[0]
      const end = project.end_date ?? todayInTZ(undefined, ctx.tz)
      const startDate = new Date(start + 'T00:00:00Z')
      const endDate = new Date(end + 'T00:00:00Z')
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const cap = endDate < today ? endDate : today

      // Walk day-by-day from start → cap
      const points: { date: string; total: number; done: number; ideal: number }[] = []
      const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000))
      const finalTotal = (tasks ?? []).length

      const cursor = new Date(startDate)
      let day = 0
      while (cursor <= cap && day <= 90) { // safety cap at 90 points
        const iso = cursor.toISOString().split('T')[0]
        let total = 0
        let done = 0
        for (const t of tasks ?? []) {
          if (t.created_at.split('T')[0] <= iso) total++
          if (t.status === 'done' && t.updated_at.split('T')[0] <= iso) done++
        }
        const ideal = Math.max(0, finalTotal - Math.round((finalTotal * day) / totalDays))
        points.push({ date: iso, total, done, ideal })
        cursor.setUTCDate(cursor.getUTCDate() + 1)
        day++
      }
      return { points, start, end }
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
      // Same gate every other project endpoint uses: only projects this user can see.
      if (!ctx.projectIds.includes(projectId)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proyecto no encontrado.' })
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Análisis con IA')
      enforceRateLimit(`${ctx.me.id}:aiInsight`)
      gcBuckets()
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

      let parsed
      try {
        parsed = parseAiJson(
          await generateFlash(prompt, { feature: 'projects.aiInsight', orgId: ctx.activeOrg?.id }),
          projectInsightSchema,
        )
      } catch (err) {
        console.error('[projects.aiInsight] gemini failed', err)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudo generar el análisis. Intenta de nuevo.' })
      }
      return parsed
    }),
})
