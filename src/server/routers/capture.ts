import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { requireFeature } from '@/lib/plan-limits'
import { enforceRateLimit } from '@/lib/rate-limit'
import { triggerAutomations } from '@/lib/automations'
import { notify } from '@/server/notify'
import { todayInTZ } from '@/lib/tz'
import { proposalWarning, weekBounds } from '@/lib/multiempresa'
import {
  CAPTURE_BUCKET,
  CAPTURE_BUCKET_LIMIT_BYTES,
  CAPTURE_FAILED_MESSAGE,
  CAPTURE_MAX_BYTES,
  CAPTURE_TEXT_MAX_CHARS,
  PRIORITIES,
  extForMime,
  isMimeOfKind,
  type TranscriptLine,
  type UploadKind,
} from '@/lib/capture-schema'
import {
  ensureInboxProject,
  isDirection,
  loadPct,
  loadPeople,
  visibleEmpresas,
  weekLoad,
} from '@/server/multiempresa'
import { processCapture, type CaptureCtx } from '@/server/capture-processing'
import type { Database } from '@/types/database'

type CaptureRow = Database['public']['Tables']['captures']['Row']
type ProposalRow = Database['public']['Tables']['task_proposals']['Row']

/** A capture stuck in 'processing' this long lost its worker (instance recycled) — treat as failed. */
const STALE_PROCESSING_MS = 4 * 60 * 1000
const AI_BUCKET = { tokensPerMinute: 0.5, maxBurst: 8 }

/** Idempotency key generated on the device (UUID). See supabase/migrations/20261026_capture_idempotency.sql. */
const clientIdInput = z.string().uuid().optional()

/** Postgres/PostgREST errors that mean "the client_id column doesn't exist (yet)". */
const missingClientIdColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /client_id/i.test(e.message ?? ''))

/**
 * The capture this person already created with this clientId, if any. Any error
 * (column not applied yet, transient failure) behaves like "not found": the
 * pre-idempotency behaviour, never a failed capture.
 */
async function findByClientId(ctx: CaptureCtx, clientId: string | undefined): Promise<CaptureRow | null> {
  if (!clientId) return null
  const { data, error } = await ctx.supabase
    .from('captures')
    .select('*')
    .eq('created_by', ctx.me.id)
    .eq('client_id', clientId)
    .maybeSingle()
  return error ? null : data
}

type NewCapture = Database['public']['Tables']['captures']['Insert']

/**
 * Insert a capture, carrying the clientId when there is one. A unique violation
 * means a retry raced the first attempt: return that one (`isNew: false`). If the
 * column is missing, insert without it.
 */
async function insertCapture(
  ctx: CaptureCtx,
  base: NewCapture,
  clientId: string | undefined,
): Promise<{ capture: CaptureRow; isNew: boolean }> {
  let attempt = await ctx.supabase
    .from('captures')
    .insert(clientId ? { ...base, client_id: clientId } : base)
    .select('*')
    .single()
  if (attempt.error && clientId) {
    if (attempt.error.code === '23505') {
      const existing = await findByClientId(ctx, clientId)
      if (existing) return { capture: existing, isNew: false }
    }
    if (missingClientIdColumn(attempt.error)) {
      attempt = await ctx.supabase.from('captures').insert(base).select('*').single()
    }
  }
  if (attempt.error || !attempt.data) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: attempt.error?.message ?? 'No se pudo crear la captura.' })
  }
  return { capture: attempt.data, isNew: true }
}

let bucketReady = false

async function ensureBucket(ctx: CaptureCtx) {
  if (bucketReady) return
  const { data } = await ctx.supabase.storage.getBucket(CAPTURE_BUCKET)
  if (!data) {
    const { error } = await ctx.supabase.storage.createBucket(CAPTURE_BUCKET, {
      public: false,
      fileSizeLimit: CAPTURE_BUCKET_LIMIT_BYTES,
    })
    // "already exists" races between instances are fine.
    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `No se pudo preparar el almacenamiento: ${error.message}` })
    }
  }
  bucketReady = true
}

/** Load a capture the caller may touch: same grupo, and (creator or Dirección). */
async function loadCapture(ctx: CaptureCtx, captureId: string): Promise<CaptureRow> {
  const { data } = await ctx.supabase.from('captures').select('*').eq('id', captureId).maybeSingle()
  if (!data || data.org_id !== ctx.me.org_id || (data.created_by !== ctx.me.id && !isDirection(ctx))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No encontramos esa captura.' })
  }
  if (data.status === 'processing' && Date.now() - new Date(data.created_at).getTime() > STALE_PROCESSING_MS) {
    const error = CAPTURE_FAILED_MESSAGE
    await ctx.supabase.from('captures').update({ status: 'failed', error }).eq('id', data.id)
    return { ...data, status: 'failed', error }
  }
  return data
}

const mapProposal = (p: ProposalRow, projectName: string | null) => ({
  id: p.id,
  position: p.position,
  title: p.title,
  assigneeId: p.assignee_id,
  workspaceId: p.workspace_id,
  projectId: p.project_id,
  projectName,
  dueDate: p.due_date,
  priority: p.priority,
  quote: p.quote,
  quoteAt: p.quote_at,
  confidence: p.confidence,
  warning: p.warning,
  included: p.included,
  createdTaskId: p.created_task_id,
})

type ConfirmSummary = { userId: string; name: string; tasks: string[]; channel: 'app' | 'email' }

/** Delivery channel of the notice: the assignee's preference ('app' | 'email'); anything else is in-app. */
const effectiveChannel = (c: string | null | undefined): 'app' | 'email' => (c === 'email' ? 'email' : 'app')

async function summarize(ctx: CaptureCtx, proposals: ProposalRow[]): Promise<{ created: number; notified: ConfirmSummary[] }> {
  const done = proposals.filter(p => p.created_task_id && p.assignee_id)
  const ids = Array.from(new Set(done.map(p => p.assignee_id!)))
  const { data: users } = ids.length
    ? await ctx.supabase.from('users').select('id, name, notify_channel').in('id', ids)
    : { data: [] }
  const byId = new Map((users ?? []).map(u => [u.id, u]))
  const notified: ConfirmSummary[] = ids.map(id => ({
    userId: id,
    name: byId.get(id)?.name ?? 'Alguien',
    tasks: done.filter(p => p.assignee_id === id).map(p => p.title),
    channel: effectiveChannel(byId.get(id)?.notify_channel),
  }))
  return { created: done.length, notified }
}

export const captureRouter = createTRPCRouter({
  /** Step 1 of a file capture: row + signed upload URL. The browser PUTs the file straight to Storage. */
  createUpload: protectedProcedure
    .input(z.object({ kind: z.enum(['audio', 'video', 'image']), mimeType: z.string().min(3).max(120), clientId: clientIdInput }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Captura con IA')
      if (!isMimeOfKind(input.kind as UploadKind, input.mimeType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'El tipo de archivo no coincide con lo que quieres enviar.' })
      }

      // A retry of something we already have (the offline outbox resends until it hears back):
      // past 'uploaded' it is already with Faro → say so, no new signed URL, nothing to redo.
      const prior = await findByClientId(ctx, input.clientId)
      if (prior && prior.status !== 'uploaded') {
        return { captureId: prior.id, signedUrl: null as string | null, path: prior.storage_path ?? '', maxBytes: CAPTURE_MAX_BYTES, status: prior.status, duplicate: true }
      }

      await ensureBucket(ctx)

      let capture: CaptureRow
      let duplicate = false
      if (prior) {
        capture = prior // still 'uploaded': the file may not have arrived — hand out a fresh URL
        duplicate = true
      } else {
        const inserted = await insertCapture(
          ctx,
          {
            org_id: ctx.me.org_id,
            created_by: ctx.me.id,
            kind: input.kind,
            source: 'app',
            mime_type: input.mimeType.split(';')[0].trim().toLowerCase(),
            status: 'uploaded',
          },
          input.clientId,
        )
        capture = inserted.capture
        duplicate = !inserted.isNew
        if (duplicate && capture.status !== 'uploaded') {
          return { captureId: capture.id, signedUrl: null as string | null, path: capture.storage_path ?? '', maxBytes: CAPTURE_MAX_BYTES, status: capture.status, duplicate: true }
        }
      }

      const path = `${ctx.me.org_id}/${capture.id}/original.${extForMime(capture.mime_type ?? input.mimeType)}`
      // upsert: a retried upload may overwrite a half-written object of the same capture.
      const { data: signed, error: signErr } = await ctx.supabase.storage.from(CAPTURE_BUCKET).createSignedUploadUrl(path, { upsert: true })
      if (signErr || !signed) {
        if (!duplicate) await ctx.supabase.from('captures').delete().eq('id', capture.id)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: signErr?.message ?? 'No se pudo preparar la subida.' })
      }
      await ctx.supabase.from('captures').update({ storage_path: path }).eq('id', capture.id)

      return { captureId: capture.id, signedUrl: signed.signedUrl as string | null, path, maxBytes: CAPTURE_MAX_BYTES, status: capture.status, duplicate }
    }),

  /**
   * Step 2: process an uploaded file (or retry a failed one).
   *
   * Processing is AWAITED inside this request on purpose: Cloud Run throttles
   * CPU once the response is sent (and may recycle the instance), so a
   * fire-and-forget Gemini call would stall or die. The status is flipped to
   * 'processing' first, so a client that polls `get` sees it immediately and
   * can also resume after a page reload.
   */
  submit: protectedProcedure
    .input(z.object({ captureId: z.string().uuid(), durationSec: z.number().int().min(0).max(24 * 3600).optional() }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Captura con IA')
      const capture = await loadCapture(ctx, input.captureId)
      if (capture.kind === 'text') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Las capturas de texto se envían con submitText.' })
      if (capture.status !== 'uploaded' && capture.status !== 'failed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta captura ya se procesó.' })
      }
      enforceRateLimit(`${ctx.me.id}:capture`, AI_BUCKET)

      // Conditional update = atomic claim, so a double click can't run Gemini twice.
      // created_at doubles as the "processing started" clock for the stale check in loadCapture,
      // so a retry of an old failed capture isn't mistaken for a dead worker.
      const { data: row } = await ctx.supabase
        .from('captures')
        .update({
          status: 'processing',
          error: null,
          created_at: new Date().toISOString(),
          ...(input.durationSec !== undefined ? { duration_sec: input.durationSec } : {}),
        })
        .eq('id', capture.id)
        .in('status', ['uploaded', 'failed'])
        .select('*')
        .maybeSingle()
      if (!row) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta captura ya se está procesando.' })
      await processCapture(ctx, row, ctx.session.user.name ?? ctx.session.user.email ?? '')
      const { data: after } = await ctx.supabase.from('captures').select('status, error').eq('id', capture.id).single()
      return { captureId: capture.id, status: after?.status ?? 'failed', error: after?.error ?? null }
    }),

  /** Capture from pasted text (chat, notes). */
  submitText: protectedProcedure
    .input(z.object({
      text: z.string().trim().min(3, 'Escribe o pega algo de texto.').max(CAPTURE_TEXT_MAX_CHARS),
      clientId: clientIdInput,
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Captura con IA')

      // A retry from the offline outbox: return the capture we already made (no second AI run,
      // no rate-limit token spent).
      const prior = await findByClientId(ctx, input.clientId)
      if (prior) return { captureId: prior.id, status: prior.status, error: prior.error ?? null }

      enforceRateLimit(`${ctx.me.id}:capture`, AI_BUCKET)
      const { capture, isNew } = await insertCapture(
        ctx,
        {
          org_id: ctx.me.org_id,
          created_by: ctx.me.id,
          kind: 'text',
          source: 'app',
          raw_text: input.text,
          status: 'processing',
        },
        input.clientId,
      )
      if (!isNew) return { captureId: capture.id, status: capture.status, error: capture.error ?? null }

      await processCapture(ctx, capture, ctx.session.user.name ?? ctx.session.user.email ?? '')
      const { data: after } = await ctx.supabase.from('captures').select('status, error').eq('id', capture.id).single()
      return { captureId: capture.id, status: after?.status ?? 'failed', error: after?.error ?? null }
    }),

  /** Capture + transcript + proposals (+ playback URL and the load % the review needs to recompute warnings). */
  get: protectedProcedure
    .input(z.object({ captureId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const capture = await loadCapture(ctx, input.captureId)

      const [{ data: proposals }, author, signed] = await Promise.all([
        ctx.supabase.from('task_proposals').select('*').eq('capture_id', capture.id).order('position'),
        ctx.supabase.from('users').select('name').eq('id', capture.created_by).maybeSingle(),
        capture.storage_path
          ? ctx.supabase.storage.from(CAPTURE_BUCKET).createSignedUrl(capture.storage_path, 60 * 60)
          : Promise.resolve({ data: null }),
      ])
      const rows = proposals ?? []

      const projectIds = Array.from(new Set(rows.map(p => p.project_id).filter((x): x is string => !!x)))
      const { data: projects } = projectIds.length
        ? await ctx.supabase.from('projects').select('id, name').in('id', projectIds)
        : { data: [] }
      const projectName = new Map((projects ?? []).map(p => [p.id, p.name]))

      // Load % per person per week — lets the client recompute "sobrecarga"
      // instantly when the assignee changes.
      const loads: Record<string, Record<string, number>> = {}
      if (capture.status === 'ready' && ctx.workspaceIds.length) {
        const today = todayInTZ(undefined, ctx.tz)
        const mondays = Array.from(new Set([weekBounds(today).monday, ...rows.map(p => weekBounds(p.due_date ?? today).monday)]))
        const people = await loadPeople(ctx)
        const ids = people.map(p => p.id)
        await Promise.all(
          mondays.map(async monday => {
            const w = await weekLoad(ctx, ids, monday)
            for (const id of ids) (loads[id] ??= {})[monday] = loadPct(w.get(id)?.total ?? 0)
          }),
        )
      }

      const summary = capture.status === 'confirmed' ? await summarize(ctx, rows) : null

      return {
        id: capture.id,
        kind: capture.kind,
        source: capture.source,
        status: capture.status,
        error: capture.error,
        mimeType: capture.mime_type,
        durationSec: capture.duration_sec,
        rawText: capture.raw_text,
        createdAt: capture.created_at,
        authorName: author.data?.name ?? '',
        mediaUrl: signed.data?.signedUrl ?? null,
        transcript: (Array.isArray(capture.transcript) ? capture.transcript : []) as unknown as TranscriptLine[],
        proposals: rows.map(p => mapProposal(p, p.project_id ? (projectName.get(p.project_id) ?? null) : null)),
        loads,
        summary,
      }
    }),

  /** Edit one proposal (assignee / empresa / project / date / include). Warning is recomputed server-side. */
  updateProposal: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      assigneeId: z.string().uuid().nullable().optional(),
      workspaceId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      included: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: proposal } = await ctx.supabase.from('task_proposals').select('*').eq('id', input.id).maybeSingle()
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' })
      const capture = await loadCapture(ctx, proposal.capture_id)
      if (capture.status !== 'ready') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta captura ya no se puede editar.' })
      }

      const [empresas, people] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
      const empresaIds = new Set(empresas.map(e => e.id))
      const peopleIds = new Set(people.map(p => p.id))

      const patch: Database['public']['Tables']['task_proposals']['Update'] = {}
      if (input.assigneeId !== undefined) {
        if (input.assigneeId && !peopleIds.has(input.assigneeId)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esa persona no está en tu grupo.' })
        patch.assignee_id = input.assigneeId
      }
      if (input.workspaceId !== undefined) {
        if (input.workspaceId && !empresaIds.has(input.workspaceId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a esa empresa.' })
        patch.workspace_id = input.workspaceId
      }
      if (input.projectId !== undefined) {
        if (input.projectId && !ctx.projectIds.includes(input.projectId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a ese proyecto.' })
        patch.project_id = input.projectId
      }
      if (input.dueDate !== undefined) patch.due_date = input.dueDate
      if (input.included !== undefined) patch.included = input.included

      const next = { ...proposal, ...patch }
      const week = weekBounds(next.due_date ?? todayInTZ(undefined, ctx.tz)).monday
      const loads = next.assignee_id ? await weekLoad(ctx, [next.assignee_id], week) : new Map()
      patch.warning = proposalWarning(
        {
          assigneeId: next.assignee_id,
          workspaceId: next.workspace_id,
          loadPct: next.assignee_id ? loadPct(loads.get(next.assignee_id)?.total ?? 0) : null,
        },
        people,
      )

      const { data, error } = await ctx.supabase.from('task_proposals').update(patch).eq('id', input.id).select('*').single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      return { id: data.id, warning: data.warning }
    }),

  /**
   * Turn the included proposals into real tasks and "notify" the assignees.
   * Idempotent: proposals that already created a task are skipped, so a retry
   * after a partial failure (or a double click) never duplicates tasks.
   */
  confirm: protectedProcedure
    .input(z.object({ captureId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
      const capture = await loadCapture(ctx, input.captureId)

      const { data: all } = await ctx.supabase.from('task_proposals').select('*').eq('capture_id', capture.id).order('position')
      let proposals = all ?? []

      if (capture.status === 'confirmed') return summarize(ctx, proposals)
      if (capture.status !== 'ready') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta captura no está lista para confirmar.' })
      }

      const included = proposals.filter(p => p.included)
      if (!included.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selecciona al menos una tarea.' })
      if (included.some(p => !p.assignee_id)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Hay tareas sin responsable. Elige quién se las lleva.' })
      }

      const withProject = Array.from(new Set(included.map(p => p.project_id).filter((x): x is string => !!x)))
      const [empresas, people, { data: projectRows }] = await Promise.all([
        visibleEmpresas(ctx),
        loadPeople(ctx),
        withProject.length
          ? ctx.supabase.from('projects').select('id, workspace_id').in('id', withProject)
          : Promise.resolve({ data: [] as Array<{ id: string; workspace_id: string }> }),
      ])
      const empresaIds = new Set(empresas.map(e => e.id))
      const peopleById = new Map(people.map(p => [p.id, p]))
      const projectWs = new Map((projectRows ?? []).map(p => [p.id, p.workspace_id]))

      // Resolve the empresa of every pending proposal up front so we fail before creating anything.
      const pending = included.filter(p => !p.created_task_id)
      const resolved = pending.map(p => {
        const ws =
          p.workspace_id ??
          (p.project_id ? projectWs.get(p.project_id) : null) ??
          peopleById.get(p.assignee_id!)?.memberships.find(m => empresaIds.has(m.workspaceId))?.workspaceId ??
          (empresas.length === 1 ? empresas[0].id : null)
        if (!ws || !empresaIds.has(ws)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Elige la empresa de “${p.title}”.` })
        }
        if (p.project_id && !ctx.projectIds.includes(p.project_id)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: `No tienes acceso al proyecto de “${p.title}”.` })
        }
        return { p, ws }
      })

      const inboxByWs = new Map<string, string>()
      const createdAt = Date.now()
      let i = 0
      for (const { p, ws } of resolved) {
        let projectId = p.project_id
        if (!projectId) {
          projectId = inboxByWs.get(ws) ?? null
          if (!projectId) {
            projectId = await ensureInboxProject(
              { ...ctx, activeOrg: ctx.activeOrg },
              ws,
              Array.from(new Set(resolved.filter(r => r.ws === ws).map(r => r.p.assignee_id!))),
            )
            inboxByWs.set(ws, projectId)
          }
        }

        const { data: task, error } = await ctx.supabase
          .from('tasks')
          .insert({
            project_id: projectId,
            workspace_id: ws,
            title: p.title,
            description: `Origen (${capture.kind === 'text' ? 'texto' : capture.kind}): “${p.quote}”${p.quote_at ? ` · ${p.quote_at}` : ''}`,
            assignee_id: p.assignee_id,
            reporter_id: ctx.me.id,
            priority: (PRIORITIES as readonly string[]).includes(p.priority) ? p.priority : 'medium',
            status: 'todo',
            due_date: p.due_date,
            labels: ['captura'],
            position: createdAt + i++,
          })
          .select('id, project_id, title, status, priority, assignee_id, due_date, labels')
          .single()
        if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

        await ctx.supabase.from('task_proposals').update({ created_task_id: task.id, workspace_id: ws, project_id: projectId }).eq('id', p.id)

        void ctx.supabase.from('audit_log').insert({
          org_id: ctx.me.org_id,
          entity_type: 'task',
          entity_id: task.id,
          action: 'created',
          field_changed: 'title',
          new_value: task.title,
          changed_by: ctx.me.id,
          source: 'ai',
        })
        void triggerAutomations(ctx.supabase, {
          trigger: 'task.created',
          org_id: ctx.me.org_id,
          task: {
            id: task.id,
            project_id: task.project_id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            assignee_id: task.assignee_id,
            due_date: task.due_date,
            labels: task.labels ?? [],
          },
        })
      }

      await ctx.supabase.from('captures').update({ status: 'confirmed' }).eq('id', capture.id)
      const { data: fresh } = await ctx.supabase.from('task_proposals').select('*').eq('capture_id', capture.id).order('position')
      proposals = fresh ?? proposals
      const summary = await summarize(ctx, proposals)

      // One notice per person (not one per task): "Te asignaron 3 tareas".
      for (const n of summary.notified) {
        const count = n.tasks.length
        await notify({
          supabase: ctx.supabase,
          orgId: ctx.me.org_id,
          userIds: [n.userId],
          kind: 'task_assigned',
          title: count === 1 ? 'Te asignaron una tarea' : `Te asignaron ${count} tareas`,
          body: count > 1 ? `${n.tasks[0]} y ${count - 1} más` : n.tasks[0],
          url: '/dashboard/hoy',
          entity: { type: 'capture', id: capture.id },
          actorId: ctx.me.id,
        })
      }
      return summary
    }),

  discard: protectedProcedure
    .input(z.object({ captureId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const capture = await loadCapture(ctx, input.captureId)
      if (capture.status === 'confirmed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esta captura ya se confirmó.' })
      }
      await ctx.supabase.from('captures').update({ status: 'discarded' }).eq('id', capture.id)
      if (capture.storage_path) void ctx.supabase.storage.from(CAPTURE_BUCKET).remove([capture.storage_path])
      return { ok: true }
    }),

  /** My recent captures (to resume a review that was left open). */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(30).default(8) }).optional())
    .query(async ({ ctx, input }) => {
      const { data } = await ctx.supabase
        .from('captures')
        .select('id, kind, status, source, raw_text, duration_sec, created_at')
        .eq('org_id', ctx.me.org_id)
        .eq('created_by', ctx.me.id)
        .not('status', 'in', '(discarded,uploaded)')
        .order('created_at', { ascending: false })
        .limit(input?.limit ?? 8)
      const ids = (data ?? []).map(c => c.id)
      const { data: proposals } = ids.length
        ? await ctx.supabase.from('task_proposals').select('capture_id, title, included').in('capture_id', ids).order('position')
        : { data: [] }
      return (data ?? []).map(c => {
        const mine = (proposals ?? []).filter(p => p.capture_id === c.id)
        return {
          id: c.id,
          kind: c.kind,
          status: c.status,
          source: c.source,
          durationSec: c.duration_sec,
          createdAt: c.created_at,
          preview: c.raw_text?.slice(0, 80) ?? mine[0]?.title ?? null,
          proposalCount: mine.length,
        }
      })
    }),
})
