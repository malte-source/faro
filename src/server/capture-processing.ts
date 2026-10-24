import { generateFlash, stripJsonFence } from '@/lib/gemini'
import { todayInTZ } from '@/lib/tz'
import { geminiMimeType } from '@/lib/capture-media'
import {
  normalize,
  proposalWarning,
  weekBounds,
  type DirectoryPerson,
} from '@/lib/multiempresa'
import {
  CAPTURE_BUCKET,
  CAPTURE_FAILED_MESSAGE,
  CAPTURE_JSON_SCHEMA,
  CAPTURE_MAX_BYTES,
  CAPTURE_TOO_BIG_MESSAGE,
  PRIORITIES,
  clean,
  isValidISODate,
  modelOutputSchema,
  type TranscriptLine,
} from '@/lib/capture-schema'
import type { Database, Json } from '@/types/database'
import {
  isDirection,
  loadPct,
  loadPeople,
  visibleEmpresas,
  weekLoad,
  type EmpresaCtx,
  type EmpresaRow,
  type PersonRow,
} from '@/server/multiempresa'

export type CaptureCtx = EmpresaCtx & { tz: string; projectIds: string[] }

type CaptureRow = Database['public']['Tables']['captures']['Row']

export interface CaptureProject {
  id: string
  name: string
  workspaceId: string
  sharedWith: string[]
}

export interface CaptureContext {
  empresas: EmpresaRow[]
  people: PersonRow[]
  projects: CaptureProject[]
  /** weekly load % of every person for the current week (informational for the model). */
  loadPctByUser: Map<string, number>
  today: string
}

/** Who/what the model is allowed to reference: only what the author can see. */
export async function buildCaptureContext(ctx: CaptureCtx): Promise<CaptureContext> {
  const today = todayInTZ(undefined, ctx.tz)
  const [empresas, everyone] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
  const visible = new Set(empresas.map(e => e.id))

  const people = isDirection(ctx)
    ? everyone
    : everyone.filter(p => p.id === ctx.me.id || p.memberships.some(m => visible.has(m.workspaceId)))

  let projects: CaptureProject[] = []
  if (visible.size && ctx.projectIds.length) {
    const { data } = await ctx.supabase
      .from('projects')
      .select('id, name, workspace_id')
      .in('workspace_id', Array.from(visible))
      .in('id', ctx.projectIds)
      .not('status', 'in', '(completed,canceled)')
      .order('name')
      .limit(80)
    const rows = data ?? []
    const { data: shared } = rows.length
      ? await ctx.supabase.from('project_workspaces').select('project_id, workspace_id').in('project_id', rows.map(r => r.id))
      : { data: [] }
    const sharedBy = new Map<string, string[]>()
    for (const s of shared ?? []) sharedBy.set(s.project_id, [...(sharedBy.get(s.project_id) ?? []), s.workspace_id])
    projects = rows.map(r => ({ id: r.id, name: r.name, workspaceId: r.workspace_id, sharedWith: sharedBy.get(r.id) ?? [] }))
  }

  const loads = await weekLoad(ctx, people.map(p => p.id), today)
  const loadPctByUser = new Map(people.map(p => [p.id, loadPct(loads.get(p.id)?.total ?? 0)]))

  return { empresas, people, projects, loadPctByUser, today }
}

function aliasesOf(name: string): string[] {
  const words = normalize(name).split(/[^a-z0-9]+/).filter(w => w.length >= 2)
  return Array.from(new Set([normalize(name), ...words]))
}

function modelContextJson(ctx: CaptureCtx, cc: CaptureContext, authorName: string) {
  return {
    hoy: cc.today,
    zona: ctx.tz,
    autor: { id: ctx.me.id, nombre: authorName },
    personas: cc.people.map(p => ({
      id: p.id,
      nombre: p.name,
      alias: aliasesOf(p.name),
      membresias: p.memberships.map(m => ({ empresa_id: m.workspaceId, empresa: m.workspaceName, cargo: m.position })),
      carga_semana_pct: cc.loadPctByUser.get(p.id) ?? 0,
    })),
    empresas: cc.empresas.map(e => ({ id: e.id, nombre: e.name, alias: aliasesOf(e.name) })),
    proyectos_activos: cc.projects.map(p => ({
      id: p.id,
      nombre: p.name,
      empresa_id: p.workspaceId,
      compartido_con: p.sharedWith,
    })),
  }
}

const SYSTEM_INSTRUCTION = `Eres Faro, el asistente que convierte conversaciones, audios, videos, fotos y textos en tareas concretas para un grupo de empresas.
Reglas:
- Transcribe (audio/video) o lee (imagen) el contenido y devuélvelo segmentado en "transcript": cada línea con tiempo "m:ss" en audio/video ("" si no aplica) y el hablante si se puede distinguir ("" si no).
- Extrae SOLO acciones concretas: pedidos, compromisos y pendientes. Ignora comentarios, opiniones y saludos. No inventes tareas.
- Cada tarea: título imperativo corto (máximo 60 caracteres, en español neutro), "assignee_id" SOLO si alguien fue nombrado o se ofreció ("" si no: nunca adivines), empresa ("workspace_id"), proyecto ("project_id"), fecha absoluta YYYY-MM-DD (resuelve "el lunes", "mañana", "fin de mes" usando "hoy" y la zona horaria) y prioridad.
- "quote" es la frase LITERAL de donde sale la tarea (copiada tal cual) y "quote_at" su tiempo si hay.
- Usa ÚNICAMENTE ids que aparezcan en el contexto. Si no puedes deducir uno, devuelve "".
- Responde solo con el JSON pedido.`

function describeInput(c: CaptureRow, hasMedia: boolean): string {
  switch (c.kind) {
    case 'audio': return 'Adjunto hay un AUDIO. Transcríbelo y extrae las tareas.'
    case 'video': return 'Adjunto hay un VIDEO. Transcribe lo que se dice, observa lo que se ve y extrae las tareas.'
    case 'image': return 'Adjunto hay una IMAGEN (foto, captura o pizarrón). Lee todo el texto visible y extrae las tareas.'
    default: return hasMedia ? '' : 'El siguiente TEXTO (mensajes, notas o un chat pegado) es el contenido. Léelo y extrae las tareas.'
  }
}

export class CaptureFailure extends Error {
  constructor(public userMessage: string, cause?: unknown) {
    super(userMessage)
    this.cause = cause
  }
}

async function downloadBase64(ctx: CaptureCtx, path: string): Promise<{ data: string; size: number }> {
  const { data, error } = await ctx.supabase.storage.from(CAPTURE_BUCKET).download(path)
  if (error || !data) throw new CaptureFailure(CAPTURE_FAILED_MESSAGE, error)
  if (data.size > CAPTURE_MAX_BYTES) throw new CaptureFailure(CAPTURE_TOO_BIG_MESSAGE)
  const buf = Buffer.from(await data.arrayBuffer())
  return { data: buf.toString('base64'), size: buf.length }
}

function textLines(raw: string): TranscriptLine[] {
  return raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(text => ({ at: null, speaker: null, text }))
}

/**
 * Run the full pipeline for a capture: media → Gemini (structured JSON) →
 * validated proposals with server-computed warnings. Marks the capture
 * 'ready' or 'failed'; never throws for model/storage problems.
 */
export async function processCapture(ctx: CaptureCtx, capture: CaptureRow, authorName: string): Promise<void> {
  try {
    const cc = await buildCaptureContext(ctx)

    const parts: Array<string | { inlineData: { data: string; mimeType: string } }> = []
    const hasMedia = capture.kind !== 'text'
    if (hasMedia) {
      if (!capture.storage_path) throw new CaptureFailure(CAPTURE_FAILED_MESSAGE)
      const media = await downloadBase64(ctx, capture.storage_path)
      parts.push({ inlineData: { data: media.data, mimeType: geminiMimeType(capture.kind, capture.mime_type) } })
    } else if (!capture.raw_text?.trim()) {
      throw new CaptureFailure(CAPTURE_FAILED_MESSAGE)
    }

    const prompt = [
      describeInput(capture, hasMedia),
      'CONTEXTO (JSON; solo puedes usar estos ids):',
      JSON.stringify(modelContextJson(ctx, cc, authorName)),
      capture.kind === 'text' ? `TEXTO:\n"""\n${capture.raw_text}\n"""` : '',
    ].filter(Boolean).join('\n\n')

    let rawText: string
    try {
      rawText = await generateFlash([prompt, ...parts], {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseJsonSchema: CAPTURE_JSON_SCHEMA,
        temperature: 0.2,
        feature: 'capture',
        orgId: ctx.me.org_id,
      })
    } catch (err) {
      throw new CaptureFailure(CAPTURE_FAILED_MESSAGE, err)
    }

    let output
    try {
      output = modelOutputSchema.parse(JSON.parse(stripJsonFence(rawText)))
    } catch (err) {
      throw new CaptureFailure(CAPTURE_FAILED_MESSAGE, err)
    }

    // ── Validate against the context: drop anything the model made up ──────
    const peopleById = new Map(cc.people.map(p => [p.id, p]))
    const empresaIds = new Set(cc.empresas.map(e => e.id))
    const projectById = new Map(cc.projects.map(p => [p.id, p]))
    const onlyEmpresa = cc.empresas.length === 1 ? cc.empresas[0].id : null

    type Draft = {
      title: string
      assignee_id: string | null
      workspace_id: string | null
      project_id: string | null
      due_date: string | null
      priority: (typeof PRIORITIES)[number]
      quote: string
      quote_at: string | null
      confidence: number
    }
    const drafts: Draft[] = []
    for (const t of output.tasks) {
      const title = t.title.trim().slice(0, 120)
      if (!title) continue
      const assignee = clean(t.assignee_id)
      const assigneeId = assignee && peopleById.has(assignee) ? assignee : null
      const projectId = clean(t.project_id) && projectById.has(t.project_id) ? t.project_id : null
      let workspaceId = clean(t.workspace_id) && empresaIds.has(t.workspace_id) ? t.workspace_id : null
      if (!workspaceId && projectId) workspaceId = projectById.get(projectId)!.workspaceId
      if (!workspaceId && assigneeId) workspaceId = peopleById.get(assigneeId)!.memberships.find(m => empresaIds.has(m.workspaceId))?.workspaceId ?? null
      if (!workspaceId) workspaceId = onlyEmpresa
      const due = clean(t.due_date)
      const priority = (PRIORITIES as readonly string[]).includes(t.priority) ? (t.priority as Draft['priority']) : 'medium'
      drafts.push({
        title,
        assignee_id: assigneeId,
        workspace_id: workspaceId,
        project_id: projectId,
        due_date: isValidISODate(due) ? due : null,
        priority,
        quote: clean(t.quote) ?? title,
        quote_at: clean(t.quote_at),
        confidence: Math.min(1, Math.max(0, Number.isFinite(t.confidence) ? t.confidence : 0.5)),
      })
    }

    // ── Warnings (README §3.4) — computed here, never by the model ─────────
    const directory: DirectoryPerson[] = cc.people
    const weeks = new Map<string, Set<string>>() // monday → assignee ids
    for (const d of drafts) {
      if (!d.assignee_id) continue
      const monday = weekBounds(d.due_date ?? cc.today).monday
      weeks.set(monday, (weeks.get(monday) ?? new Set()).add(d.assignee_id))
    }
    const pctByWeekUser = new Map<string, number>()
    await Promise.all(
      Array.from(weeks.entries()).map(async ([monday, ids]) => {
        const loads = await weekLoad(ctx, Array.from(ids), monday)
        for (const id of ids) pctByWeekUser.set(`${monday}:${id}`, loadPct(loads.get(id)?.total ?? 0))
      }),
    )

    const { error: delErr } = await ctx.supabase.from('task_proposals').delete().eq('capture_id', capture.id)
    if (delErr) throw delErr
    if (drafts.length) {
      const { error } = await ctx.supabase.from('task_proposals').insert(
        drafts.map((d, i) => ({
          capture_id: capture.id,
          position: i,
          title: d.title,
          assignee_id: d.assignee_id,
          workspace_id: d.workspace_id,
          project_id: d.project_id,
          due_date: d.due_date,
          priority: d.priority,
          quote: d.quote,
          quote_at: d.quote_at,
          confidence: d.confidence,
          warning: proposalWarning(
            {
              assigneeId: d.assignee_id,
              workspaceId: d.workspace_id,
              loadPct: d.assignee_id ? (pctByWeekUser.get(`${weekBounds(d.due_date ?? cc.today).monday}:${d.assignee_id}`) ?? 0) : null,
            },
            directory,
          ),
        })),
      )
      if (error) throw error
    }

    const transcript: TranscriptLine[] = output.transcript
      .map(l => ({ at: clean(l.at), speaker: clean(l.speaker), text: l.text.trim() }))
      .filter(l => l.text)
    const finalTranscript = transcript.length ? transcript : capture.kind === 'text' ? textLines(capture.raw_text ?? '') : []

    const { error: upErr } = await ctx.supabase
      .from('captures')
      .update({ status: 'ready', error: null, transcript: finalTranscript as unknown as Json })
      .eq('id', capture.id)
    if (upErr) throw upErr
  } catch (err) {
    const message = err instanceof CaptureFailure ? err.userMessage : CAPTURE_FAILED_MESSAGE
    console.warn('[capture.process] failed:', capture.id, err instanceof CaptureFailure ? (err.cause ?? err.message) : err)
    await ctx.supabase.from('captures').update({ status: 'failed', error: message }).eq('id', capture.id)
  }
}

