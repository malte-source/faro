import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { limitsFor } from '@/lib/plan-limits'
import type { IntakeField } from '@/types/database'

/**
 * Public endpoint — receives form submissions from anyone on the internet.
 *
 * Security model:
 *   - No auth. The slug acts as a capability URL (knowing it = right to submit).
 *   - Rate limiting in memory by IP (max 10 submissions / 10 min per IP per
 *     form slug). Resets on Cloud Run cold start, which is fine — a real
 *     abuser will trip the limit anyway and won't keep at it cold-start-by-
 *     cold-start. For tougher limits put Cloudflare in front later.
 *   - Honeypot field "__website" — bots fill every input, real users don't
 *     see this one. If filled, silently 200 and discard.
 *   - Service-role Supabase client (server-only secret).
 */

const SUBMIT_LIMIT = 10            // per IP per slug per window
const WINDOW_MS = 10 * 60 * 1000   // 10 min

interface RateBucket { count: number; resetAt: number }
const buckets = new Map<string, RateBucket>()

function rateLimit(key: string): boolean {
  const now = Date.now()
  const cur = buckets.get(key)
  if (!cur || cur.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (cur.count >= SUBMIT_LIMIT) return false
  cur.count++
  return true
}

// Periodic GC so the map doesn't grow without bound.
function gcBuckets() {
  if (buckets.size < 1000) return
  const now = Date.now()
  for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k)
}

function getIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

interface SubmissionBody {
  fields: Record<string, string>
  __website?: string  // honeypot
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ip = getIp(req)

  // Rate limit BEFORE parsing — protects against bursts of malformed POSTs.
  if (!rateLimit(`${slug}:${ip}`)) {
    return NextResponse.json({ error: 'Too many submissions. Try again later.' }, { status: 429 })
  }
  gcBuckets()

  let body: SubmissionBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Honeypot trap — silently succeed (don't tell the bot it was caught).
  if (body.__website && body.__website.trim().length > 0) {
    return NextResponse.json({ ok: true })
  }

  const supabase = createAdminSupabaseClient()
  const { data: form, error: formErr } = await supabase
    .from('intake_forms')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()
  if (formErr || !form) {
    return NextResponse.json({ error: 'Formulario no encontrado o inactivo.' }, { status: 404 })
  }

  // Forms are a paid feature (gated at creation time in forms.create), but an
  // org can downgrade to free after creating one — re-check here so a stale
  // form on a downgraded workspace stops silently accepting submissions.
  const { data: org } = await supabase
    .from('organizations')
    .select('plan')
    .eq('id', form.org_id)
    .single()
  if (!limitsFor(org?.plan).forms) {
    return NextResponse.json({ error: 'Este formulario ya no está disponible.' }, { status: 403 })
  }

  // Validate required fields are present.
  const fieldDefs = (form.fields as IntakeField[] | null) ?? []
  for (const f of fieldDefs) {
    if (f.required && !body.fields[f.id]?.trim()) {
      return NextResponse.json({ error: `Falta el campo requerido: ${f.label}` }, { status: 400 })
    }
  }

  // Map field answers → task attributes based on each field's `target`.
  let title = ''
  let description = ''
  let dueDate: string | null = null
  let priority: string = form.default_priority ?? 'medium'
  const metadata: Record<string, string> = {}

  for (const f of fieldDefs) {
    const raw = body.fields[f.id]?.trim() ?? ''
    if (!raw) continue
    switch (f.target) {
      case 'title':
        title = title ? `${title} · ${raw}` : raw
        break
      case 'description':
        description += (description ? '\n\n' : '') + `${f.label}: ${raw}`
        break
      case 'due_date':
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) dueDate = raw
        break
      case 'priority':
        if (['very_high', 'high', 'medium', 'low', 'very_low'].includes(raw)) priority = raw
        break
      case 'metadata':
        metadata[f.label] = raw
        break
    }
  }

  // Fall back: if no field was mapped to title, use the form's title + a snippet.
  if (!title) {
    title = `[${form.title}] ${Object.values(body.fields).find(v => v?.trim())?.slice(0, 80) ?? 'Nuevo pedido'}`
  }

  // Append metadata block to description so the task has all answers.
  if (Object.keys(metadata).length > 0) {
    description += (description ? '\n\n' : '') + '─── Datos del formulario ───\n' +
      Object.entries(metadata).map(([k, v]) => `${k}: ${v}`).join('\n')
  }
  // Identify the submitter source for the team.
  description += `\n\n_Origen: formulario público "${form.title}"_`

  // Resolve a creator user — needed by reporter_id NOT NULL constraint.
  // We use the form's created_by as the proxy. The "real" submitter is anonymous.
  const creatorId = form.created_by

  // Insert the task.
  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .insert({
      project_id: form.target_project_id,
      title: title.slice(0, 200),
      description,
      reporter_id: creatorId,
      priority: priority as 'very_high' | 'high' | 'medium' | 'low' | 'very_low',
      status: 'todo' as const,
      due_date: dueDate,
      position: Date.now(),
    })
    .select('id')
    .single()

  // Always log the submission, even if task creation failed (for debugging).
  await supabase.from('intake_submissions').insert({
    form_id: form.id,
    raw_data: body.fields,
    created_task_id: task?.id ?? null,
    submitter_ip: ip,
    user_agent: req.headers.get('user-agent') ?? null,
  })

  if (taskErr) {
    console.error('[forms.submit] task creation failed', taskErr)
    return NextResponse.json({ error: 'No pudimos procesar tu pedido. Reintenta en un momento.' }, { status: 500 })
  }

  // Increment the form's counter (best-effort).
  await supabase
    .from('intake_forms')
    .update({ submission_count: form.submission_count + 1 })
    .eq('id', form.id)

  return NextResponse.json({
    ok: true,
    message: form.success_message,
  })
}
