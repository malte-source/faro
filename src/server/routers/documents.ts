import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { generateFlash, stripJsonFence } from '@/lib/gemini'
import { enforceRateLimit } from '@/lib/rate-limit'
import { requireFeature } from '@/lib/plan-limits'
import { addDays, todayInTZ } from '@/lib/tz'
import { normalize } from '@/lib/multiempresa'
import { isDirection, loadPeople, visibleEmpresas } from '@/server/multiempresa'
import { ACUERDO_DISCLAIMER, DEFAULT_REVIEW_DAYS } from '@/lib/documents'
import {
  DOC_SYSTEM_INSTRUCTION,
  REVIEW_JSON_SCHEMA,
  generatePrompt,
  improvePrompt,
  reviewPrompt,
  stripMarkdownFence,
} from '@/server/document-prompts'
import type { CorporateLayer, Database, DocumentKind, DocumentStatus } from '@/types/database'

/**
 * Documentos — repositorio de políticas, manuales, SOPs, actas, RACI, JD, SLAs
 * y acuerdos con flujo borrador → revisión → aprobado, historial de versiones
 * y ayudas de IA (generar, mejorar, revisar).
 *
 * Alcance: workspace_id NULL = todo el grupo (visible para todos los miembros);
 * con valor = solo quienes ven esa empresa (visibleEmpresas).
 *
 * Versiones: al cambiar título/cuerpo se guarda un snapshot del contenido
 * ANTERIOR y sube `version`, pero solo cuando empieza una "sesión de edición"
 * (documento quieto más de 10 min), cuando se edita un aprobado o cuando el
 * usuario pasa una nota. Así el autoguardado cada 1,5 s no llena el historial.
 */

const KINDS = ['politica', 'manual', 'sop', 'acta', 'raci', 'jd', 'sla', 'acuerdo', 'otro'] as const
const SESSION_MS = 10 * 60 * 1000
const BODY_MAX = 200_000

const LAYER_LABEL: Record<CorporateLayer, string> = {
  gobierno: 'Gobierno',
  coe: 'Centro de Excelencia',
  sso: 'Servicios Compartidos',
  filial: 'Filial',
}

type Ctx = Parameters<typeof visibleEmpresas>[0] & {
  session: { user: { email?: string | null; name?: string | null } }
  tz: string
  projectIds: string[]
}

interface DocRow {
  id: string
  org_id: string
  workspace_id: string | null
  kind: DocumentKind
  title: string
  status: DocumentStatus
  body_md: string
  owner_id: string | null
  reviewer_id: string | null
  approved_by: string | null
  approved_at: string | null
  next_review_at: string | null
  version: number
  project_id: string | null
  task_id: string | null
  tags: string[]
  created_by: string | null
  created_at: string
  updated_at: string
}

const DOC_COLS =
  'id, org_id, workspace_id, kind, title, status, body_md, owner_id, reviewer_id, approved_by, approved_at, next_review_at, version, project_id, task_id, tags, created_by, created_at, updated_at'
const LIST_COLS =
  'id, org_id, workspace_id, kind, title, status, owner_id, reviewer_id, approved_at, next_review_at, version, project_id, task_id, tags, created_by, created_at, updated_at'

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

async function usersById(ctx: Ctx, ids: Array<string | null | undefined>) {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)))
  const map = new Map<string, { id: string; name: string; avatarUrl: string | null }>()
  if (!unique.length) return map
  const { data } = await ctx.supabase.from('users').select('id, name, avatar_url').in('id', unique)
  for (const u of data ?? []) map.set(u.id, { id: u.id, name: u.name, avatarUrl: u.avatar_url })
  return map
}

/** Load a document the caller may see (org + empresa scope) or throw NOT_FOUND. */
async function loadDoc(ctx: Ctx, id: string): Promise<DocRow> {
  if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
  const { data } = await ctx.supabase.from('documents').select(DOC_COLS).eq('id', id).maybeSingle()
  const doc = data as DocRow | null
  if (!doc || doc.org_id !== ctx.activeOrg.id) throw new TRPCError({ code: 'NOT_FOUND', message: 'El documento no existe.' })
  if (doc.workspace_id) {
    const visible = await visibleEmpresas(ctx)
    if (!visible.some(e => e.id === doc.workspace_id)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'El documento no existe.' })
    }
  }
  return doc
}

async function assertVisibleEmpresa(ctx: Ctx, workspaceId: string | null | undefined) {
  if (!workspaceId) return
  const visible = await visibleEmpresas(ctx)
  if (!visible.some(e => e.id === workspaceId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a esa empresa.' })
  }
}

async function assertOrgPerson(ctx: Ctx, userId: string | null | undefined) {
  if (!userId) return
  const people = await loadPeople(ctx)
  if (!people.some(p => p.id === userId)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esa persona no es parte del grupo.' })
  }
}

const canManage = (ctx: Ctx, doc: DocRow) =>
  isDirection(ctx) || doc.owner_id === ctx.me.id || doc.created_by === ctx.me.id

const canReview = (ctx: Ctx, doc: DocRow) => isDirection(ctx) || doc.reviewer_id === ctx.me.id

/** Save the CURRENT content of `doc` under its current version number (updates the snapshot if it already exists). */
async function snapshot(ctx: Ctx, doc: DocRow, note?: string | null) {
  const { data: existing } = await ctx.supabase
    .from('document_versions')
    .select('id')
    .eq('document_id', doc.id)
    .eq('version', doc.version)
    .maybeSingle()
  if (existing) {
    await ctx.supabase
      .from('document_versions')
      .update({ title: doc.title, body_md: doc.body_md, ...(note ? { note } : {}) })
      .eq('id', existing.id)
  } else {
    await ctx.supabase.from('document_versions').insert({
      document_id: doc.id,
      version: doc.version,
      title: doc.title,
      body_md: doc.body_md,
      saved_by: ctx.me.id,
      note: note ?? null,
    })
  }
}

// ── Estructura del grupo para la IA ────────────────────────────────────────

/** Text description of empresas, people, layers and reporting lines. Returns null when there is nothing useful. */
async function structureContext(ctx: Ctx): Promise<string | null> {
  const [empresas, allPeople] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
  // In grupo mode a member only learns about people who wear a hat in an empresa they can see.
  const people = ctx.activeOrg?.workspace_scoped && !isDirection(ctx) ? allPeople.filter(p => p.memberships.length > 0) : allPeople
  if (!people.length && !empresas.length) return null

  const ids = people.map(p => p.id)
  const { data: users } = ids.length
    ? await ctx.supabase
        .from('users')
        .select('id, name, position, role_code, corporate_layer, kpi_description, reports_to_user_id, dotted_line_to_user_id')
        .in('id', ids)
    : { data: [] }
  const byId = new Map((users ?? []).map(u => [u.id, u]))
  const nameOf = (id: string | null) => (id ? (byId.get(id)?.name ?? people.find(p => p.id === id)?.name ?? null) : null)

  const lines: string[] = []
  if (empresas.length) lines.push(`EMPRESAS: ${empresas.map(e => e.name).join(' · ')}`)
  if (people.length) {
    lines.push('PERSONAS:')
    for (const p of people.slice(0, 80)) {
      const u = byId.get(p.id)
      const parts = [p.name]
      if (u?.role_code) parts.push(u.role_code)
      const hats = p.memberships.map(m => `${m.workspaceName}: ${m.position}`)
      if (hats.length) parts.push(`cargos → ${hats.join('; ')}`)
      else if (u?.position) parts.push(`cargo: ${u.position}`)
      if (u?.corporate_layer) parts.push(`capa: ${LAYER_LABEL[u.corporate_layer as CorporateLayer] ?? u.corporate_layer}`)
      const solid = nameOf(u?.reports_to_user_id ?? null)
      if (solid) parts.push(`reporta (línea sólida) a ${solid}`)
      const dotted = nameOf(u?.dotted_line_to_user_id ?? null)
      if (dotted) parts.push(`línea punteada a ${dotted}`)
      if (u?.kpi_description) parts.push(`KPI: ${u.kpi_description}`)
      lines.push(`- ${parts.join(' · ')}`)
    }
  }
  return lines.join('\n')
}

async function runModel(prompt: string, opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  try {
    return await generateFlash(prompt, {
      feature: 'documents',
      timeoutMs: 60_000, // drafting a full policy/manual legitimately takes longer than the 25 s text default
      systemInstruction: DOC_SYSTEM_INSTRUCTION,
      temperature: opts.temperature ?? 0.4,
      ...(opts.json ? { responseJsonSchema: REVIEW_JSON_SCHEMA } : {}),
    })
  } catch (err) {
    console.error('[documents] gemini failed', err)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Faro no pudo procesar el documento. Intenta de nuevo.' })
  }
}

function withDisclaimer(kind: DocumentKind, body: string): string {
  if (kind !== 'acuerdo') return body
  return body.includes(ACUERDO_DISCLAIMER) ? body : `> ${ACUERDO_DISCLAIMER}\n\n${body}`
}

// ── Router ─────────────────────────────────────────────────────────────────

export const documentsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['borrador', 'en_revision', 'aprobado', 'obsoleto']).optional(),
      kind: z.enum(KINDS).optional(),
      workspaceId: z.string().uuid().optional(),
      q: z.string().trim().max(80).optional(),
      mine: z.boolean().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const org = ctx.activeOrg
      if (!org) return { documents: [], empresas: [] }
      const empresas = await visibleEmpresas(ctx)
      const visibleIds = empresas.map(e => e.id)
      const today = todayInTZ(undefined, ctx.tz)

      let q = ctx.supabase.from('documents').select(LIST_COLS).eq('org_id', org.id).order('updated_at', { ascending: false }).limit(500)
      q = visibleIds.length
        ? q.or(`workspace_id.is.null,workspace_id.in.(${visibleIds.join(',')})`)
        : q.is('workspace_id', null)
      if (input?.status) q = q.eq('status', input.status)
      if (input?.kind) q = q.eq('kind', input.kind)
      if (input?.workspaceId) {
        if (!visibleIds.includes(input.workspaceId)) return { documents: [], empresas }
        q = q.eq('workspace_id', input.workspaceId)
      }
      const { data, error } = await q
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      let rows = (data ?? []) as Array<Omit<DocRow, 'body_md'>>

      if (input?.mine) rows = rows.filter(r => r.owner_id === ctx.me.id || r.reviewer_id === ctx.me.id)
      if (input?.q) {
        const needle = normalize(input.q)
        rows = rows.filter(r => normalize(r.title).includes(needle) || r.tags.some(t => normalize(t).includes(needle)))
      }

      const people = await usersById(ctx, rows.flatMap(r => [r.owner_id, r.reviewer_id]))
      const empresaName = new Map(empresas.map(e => [e.id, e]))
      return {
        empresas,
        documents: rows.map(r => ({
          id: r.id,
          title: r.title,
          kind: r.kind,
          status: r.status,
          version: r.version,
          tags: r.tags,
          workspace: r.workspace_id ? (empresaName.get(r.workspace_id) ? { id: r.workspace_id, name: empresaName.get(r.workspace_id)!.name, color: empresaName.get(r.workspace_id)!.color } : null) : null,
          owner: r.owner_id ? (people.get(r.owner_id) ?? null) : null,
          reviewer: r.reviewer_id ? (people.get(r.reviewer_id) ?? null) : null,
          nextReviewAt: r.next_review_at,
          reviewOverdue: r.status === 'aprobado' && !!r.next_review_at && r.next_review_at < today,
          updatedAt: r.updated_at,
          taskId: r.task_id,
          mine: r.owner_id === ctx.me.id || r.reviewer_id === ctx.me.id,
        })),
      }
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      const today = todayInTZ(undefined, ctx.tz)
      const [people, empresas, task, project] = await Promise.all([
        usersById(ctx, [doc.owner_id, doc.reviewer_id, doc.approved_by, doc.created_by]),
        visibleEmpresas(ctx),
        doc.task_id
          ? ctx.supabase.from('tasks').select('id, title, status, project_id').eq('id', doc.task_id).maybeSingle()
          : Promise.resolve({ data: null }),
        doc.project_id
          ? ctx.supabase.from('projects').select('id, name, code').eq('id', doc.project_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const taskVisible = task.data && ctx.projectIds.includes(task.data.project_id)
      const projectVisible = project.data && ctx.projectIds.includes(project.data.id)
      const empresa = doc.workspace_id ? empresas.find(e => e.id === doc.workspace_id) : null
      return {
        id: doc.id,
        title: doc.title,
        kind: doc.kind,
        status: doc.status,
        bodyMd: doc.body_md,
        version: doc.version,
        tags: doc.tags,
        workspaceId: doc.workspace_id,
        workspace: empresa ? { id: empresa.id, name: empresa.name, color: empresa.color } : null,
        owner: doc.owner_id ? (people.get(doc.owner_id) ?? null) : null,
        reviewer: doc.reviewer_id ? (people.get(doc.reviewer_id) ?? null) : null,
        approvedBy: doc.approved_by ? (people.get(doc.approved_by) ?? null) : null,
        approvedAt: doc.approved_at,
        nextReviewAt: doc.next_review_at,
        reviewOverdue: doc.status === 'aprobado' && !!doc.next_review_at && doc.next_review_at < today,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        task: taskVisible ? { id: task.data!.id, title: task.data!.title, status: task.data!.status, projectId: task.data!.project_id } : null,
        project: projectVisible ? { id: project.data!.id, name: project.data!.name, code: project.data!.code } : null,
        permissions: {
          canEdit: doc.status !== 'obsoleto',
          canManage: canManage(ctx, doc),
          canReview: canReview(ctx, doc),
          isReviewer: doc.reviewer_id === ctx.me.id,
        },
      }
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().trim().min(1).max(160),
      kind: z.enum(KINDS).default('otro'),
      workspaceId: z.string().uuid().nullish(),
      body_md: z.string().max(BODY_MAX).default(''),
      taskId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      reviewerId: z.string().uuid().nullish(),
      nextReviewAt: dateOnly.nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.activeOrg
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' })

      let projectId = input.projectId ?? null
      let workspaceId = input.workspaceId ?? null
      if (input.taskId) {
        const { data: task } = await ctx.supabase.from('tasks').select('id, project_id, workspace_id').eq('id', input.taskId).maybeSingle()
        if (!task || !ctx.projectIds.includes(task.project_id)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a esa tarea.' })
        }
        projectId = projectId ?? task.project_id
        if (input.workspaceId === undefined) workspaceId = task.workspace_id
      }
      if (projectId && !ctx.projectIds.includes(projectId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a ese proyecto.' })
      }
      // A task-derived empresa that the caller can't see falls back to "todo el grupo" instead of failing.
      if (workspaceId && input.workspaceId === undefined) {
        const visible = await visibleEmpresas(ctx)
        if (!visible.some(e => e.id === workspaceId)) workspaceId = null
      }
      await assertVisibleEmpresa(ctx, workspaceId)
      await assertOrgPerson(ctx, input.reviewerId)

      const { data, error } = await ctx.supabase
        .from('documents')
        .insert({
          org_id: org.id,
          workspace_id: workspaceId,
          kind: input.kind,
          title: input.title,
          body_md: withDisclaimer(input.kind, input.body_md),
          owner_id: ctx.me.id,
          created_by: ctx.me.id,
          reviewer_id: input.reviewerId ?? null,
          next_review_at: input.nextReviewAt ?? null,
          task_id: input.taskId ?? null,
          project_id: projectId,
        })
        .select('id')
        .single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      return { id: data.id }
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(160).optional(),
      body_md: z.string().max(BODY_MAX).optional(),
      kind: z.enum(KINDS).optional(),
      workspaceId: z.string().uuid().nullable().optional(),
      reviewerId: z.string().uuid().nullable().optional(),
      nextReviewAt: dateOnly.nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
      /** Optional label for the version being closed ("Versión revisada por Legal"). Forces a snapshot. */
      note: z.string().trim().max(160).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (doc.status === 'obsoleto') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Este documento es obsoleto. Reábrelo para editarlo.' })
      }
      if (input.workspaceId !== undefined) await assertVisibleEmpresa(ctx, input.workspaceId)
      if (input.reviewerId !== undefined) await assertOrgPerson(ctx, input.reviewerId)
      // Anyone who can see a document may edit its text; scope, type and reviewer are governance.
      const governance =
        (input.workspaceId !== undefined && input.workspaceId !== doc.workspace_id) ||
        (input.reviewerId !== undefined && input.reviewerId !== doc.reviewer_id) ||
        (input.kind !== undefined && input.kind !== doc.kind)
      if (governance && !canManage(ctx, doc)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el responsable del documento o Dirección puede cambiar su empresa, tipo o revisor.' })
      }

      const titleChanged = input.title !== undefined && input.title !== doc.title
      const bodyChanged = input.body_md !== undefined && input.body_md !== doc.body_md
      const patch: Database['public']['Tables']['documents']['Update'] = {}
      let version = doc.version
      let reopened = false
      let snapshotted = false

      if (titleChanged || bodyChanged) {
        const idle = Date.now() - new Date(doc.updated_at).getTime()
        if (doc.status === 'aprobado' || !!input.note || idle > SESSION_MS) {
          await snapshot(ctx, doc, input.note)
          version = doc.version + 1
          snapshotted = true
        }
        patch.version = version
        if (titleChanged) patch.title = input.title
        if (bodyChanged) patch.body_md = withDisclaimer(input.kind ?? doc.kind, input.body_md!)
        if (doc.status === 'aprobado') {
          patch.status = 'borrador'
          patch.approved_by = null
          patch.approved_at = null
          reopened = true
        }
      }
      if (input.kind !== undefined) patch.kind = input.kind
      if (input.workspaceId !== undefined) patch.workspace_id = input.workspaceId
      if (input.reviewerId !== undefined) patch.reviewer_id = input.reviewerId
      if (input.nextReviewAt !== undefined) patch.next_review_at = input.nextReviewAt
      if (input.tags !== undefined) patch.tags = input.tags

      if (Object.keys(patch).length === 0) {
        return { ok: true, version, status: doc.status, reopened: false, snapshotted: false, updatedAt: doc.updated_at }
      }
      const { data, error } = await ctx.supabase.from('documents').update(patch).eq('id', doc.id).select('updated_at, status').single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      return { ok: true, version, status: data.status as DocumentStatus, reopened, snapshotted, updatedAt: data.updated_at }
    }),

  submitForReview: protectedProcedure
    .input(z.object({ id: z.string().uuid(), reviewerId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (!canManage(ctx, doc)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el responsable del documento o Dirección puede enviarlo a revisión.' })
      if (doc.status !== 'borrador') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo un borrador se envía a revisión.' })
      const reviewerId = input.reviewerId ?? doc.reviewer_id
      if (!reviewerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Elige quién revisa el documento.' })
      await assertOrgPerson(ctx, reviewerId)
      if (!doc.body_md.trim()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'El documento está vacío.' })
      await ctx.supabase.from('documents').update({ status: 'en_revision', reviewer_id: reviewerId }).eq('id', doc.id)
      return { ok: true }
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (doc.status !== 'en_revision') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo se aprueba un documento en revisión.' })
      if (!canReview(ctx, doc)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo quien revisa el documento o Dirección puede aprobarlo.' })
      // Segregación de funciones: quien redactó o es responsable no aprueba su propio documento (salvo Dirección).
      if (!isDirection(ctx) && (doc.owner_id === ctx.me.id || doc.created_by === ctx.me.id)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Quien redacta un documento no puede aprobarlo: necesita otra persona.' })
      }
      const today = todayInTZ(undefined, ctx.tz)
      await snapshot(ctx, doc, 'Versión aprobada')
      await ctx.supabase
        .from('documents')
        .update({
          status: 'aprobado',
          approved_by: ctx.me.id,
          approved_at: new Date().toISOString(),
          next_review_at: doc.next_review_at ?? addDays(today, DEFAULT_REVIEW_DAYS),
        })
        .eq('id', doc.id)
      return { ok: true }
    }),

  requestChanges: protectedProcedure
    .input(z.object({ id: z.string().uuid(), comment: z.string().trim().min(1).max(600) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (doc.status !== 'en_revision') throw new TRPCError({ code: 'BAD_REQUEST', message: 'El documento no está en revisión.' })
      if (!canReview(ctx, doc)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo quien revisa el documento o Dirección puede pedir cambios.' })
      const who = ctx.session.user.name ?? 'Revisión'
      // The comment lives in the version history, attached to the content that was reviewed.
      await snapshot(ctx, doc, `Cambios pedidos por ${who}: ${input.comment}`)
      await ctx.supabase.from('documents').update({ status: 'borrador' }).eq('id', doc.id)
      return { ok: true }
    }),

  markObsolete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (!canManage(ctx, doc)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el responsable del documento o Dirección puede marcarlo obsoleto.' })
      await ctx.supabase.from('documents').update({ status: 'obsoleto' }).eq('id', doc.id)
      return { ok: true }
    }),

  reopen: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (doc.status !== 'obsoleto') throw new TRPCError({ code: 'BAD_REQUEST', message: 'El documento no es obsoleto.' })
      if (!canManage(ctx, doc)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el responsable del documento o Dirección puede reabrirlo.' })
      await ctx.supabase.from('documents').update({ status: 'borrador', approved_by: null, approved_at: null }).eq('id', doc.id)
      return { ok: true }
    }),

  versions: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      const { data } = await ctx.supabase
        .from('document_versions')
        .select('id, version, title, body_md, saved_by, note, saved_at')
        .eq('document_id', doc.id)
        .order('version', { ascending: false })
        .limit(100)
      const rows = data ?? []
      const people = await usersById(ctx, rows.map(r => r.saved_by))
      return {
        current: { version: doc.version, title: doc.title, updatedAt: doc.updated_at },
        // The current version has no snapshot of its own unless one was taken for a review/approval note.
        versions: rows
          .filter(r => r.version !== doc.version || !!r.note)
          .map(r => ({
            id: r.id,
            version: r.version,
            title: r.title,
            bodyMd: r.body_md,
            note: r.note,
            savedAt: r.saved_at,
            savedBy: r.saved_by ? (people.get(r.saved_by) ?? null) : null,
            isCurrent: r.version === doc.version,
          })),
      }
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (doc.status === 'obsoleto') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Este documento es obsoleto. Reábrelo para restaurar una versión.' })
      const { data: v } = await ctx.supabase
        .from('document_versions')
        .select('title, body_md')
        .eq('document_id', doc.id)
        .eq('version', input.version)
        .maybeSingle()
      if (!v) throw new TRPCError({ code: 'NOT_FOUND', message: 'Esa versión no existe.' })

      await snapshot(ctx, doc, `Antes de restaurar la versión ${input.version}`)
      const { error } = await ctx.supabase
        .from('documents')
        .update({
          title: v.title,
          body_md: v.body_md,
          version: doc.version + 1,
          status: 'borrador',
          approved_by: null,
          approved_at: null,
        })
        .eq('id', doc.id)
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      return { ok: true, version: doc.version + 1 }
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDoc(ctx, input.id)
      if (!canManage(ctx, doc)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el responsable del documento o Dirección puede borrarlo.' })
      await ctx.supabase.from('documents').delete().eq('id', doc.id)
      return { ok: true }
    }),

  // ── IA ───────────────────────────────────────────────────────────────────

  /** Draft a document. Does NOT save: the UI calls `create` with the result. */
  generate: protectedProcedure
    .input(z.object({
      kind: z.enum(KINDS),
      title: z.string().trim().min(1).max(160),
      brief: z.string().trim().max(3000).default(''),
      workspaceId: z.string().uuid().nullish(),
      useStructure: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Generar documentos con IA')
      enforceRateLimit(`${ctx.me.id}:docs`)
      await assertVisibleEmpresa(ctx, input.workspaceId)

      const empresas = await visibleEmpresas(ctx)
      const empresa = input.workspaceId ? empresas.find(e => e.id === input.workspaceId) : null
      const structure = input.useStructure ? await structureContext(ctx) : null
      const prompt = generatePrompt({
        kind: input.kind,
        title: input.title,
        brief: input.brief,
        today: todayInTZ(undefined, ctx.tz),
        groupName: ctx.activeOrg?.name ?? 'el grupo',
        scopeLine: empresa ? `empresa «${empresa.name}»` : 'todo el grupo (todas las empresas)',
        structure,
      })
      const raw = stripMarkdownFence(await runModel(prompt))
      if (!raw) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Faro no pudo redactar el documento. Intenta de nuevo.' })
      return { title: input.title, body_md: withDisclaimer(input.kind, raw) }
    }),

  /** Rewrite a document (saved one by id, or a body passed in) following an instruction. Does NOT save. */
  improve: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      body_md: z.string().max(BODY_MAX).optional(),
      instruction: z.string().trim().min(3).max(600),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Mejorar documentos con IA')
      enforceRateLimit(`${ctx.me.id}:docs`)
      let body = input.body_md
      let kind: DocumentKind = 'otro'
      if (input.id) {
        const doc = await loadDoc(ctx, input.id)
        kind = doc.kind
        body = body ?? doc.body_md
      }
      if (!body?.trim()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No hay texto para mejorar.' })
      const out = stripMarkdownFence(await runModel(improvePrompt({ body, instruction: input.instruction })))
      if (!out) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Faro no pudo editar el documento. Intenta de nuevo.' })
      return { body_md: withDisclaimer(kind, out) }
    }),

  /** Critical review: gaps, ambiguities, contradictions and incoherence with the grupo's structure. */
  review: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Revisar documentos con IA')
      enforceRateLimit(`${ctx.me.id}:docs`)
      const doc = await loadDoc(ctx, input.id)
      if (!doc.body_md.trim()) throw new TRPCError({ code: 'BAD_REQUEST', message: 'El documento está vacío.' })
      const structure = await structureContext(ctx)
      const raw = await runModel(
        reviewPrompt({ kind: doc.kind, title: doc.title, body: doc.body_md, structure }),
        { json: true, temperature: 0.2 },
      )
      const schema = z.object({ findings: z.array(z.object({ severity: z.enum(['alta', 'media', 'baja']), text: z.string().min(1) })) })
      let parsed: z.infer<typeof schema>
      try {
        parsed = schema.parse(JSON.parse(stripJsonFence(raw)))
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Faro no pudo revisar el documento. Intenta de nuevo.' })
      }
      const order = { alta: 0, media: 1, baja: 2 } as const
      return { findings: parsed.findings.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 12) }
    }),
})
