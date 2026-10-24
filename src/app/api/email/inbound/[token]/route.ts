import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { limitsFor } from '@/lib/plan-limits'

/**
 * Email-to-task inbound webhook.
 *
 * URL: POST /api/email/inbound/{token}
 *
 * Designed to be compatible with multiple email-forwarding services without
 * us locking into one:
 *
 *   1. Mailgun → fields `sender`, `subject`, `body-plain`, `body-html`, `attachments`
 *   2. Postmark → fields `From`, `Subject`, `TextBody`, `HtmlBody`, `Attachments`
 *   3. SendGrid Inbound Parse → multipart form (not implemented yet — most
 *      teams pick one of the JSON-based services first).
 *   4. Generic JSON → fields `from`, `subject`, `body`, `attachments`
 *      (custom Zapier/Make/n8n flows, scripts).
 *
 * The endpoint accepts whatever's in the POST body and normalises the keys.
 * For signature verification (Mailgun has it) we leave it for v2 — the
 * 144-bit token in the URL already protects against random POSTs.
 *
 * Rate limit: same in-memory bucket pattern as /api/forms (10 req / 10 min per token).
 */

const SUBMIT_LIMIT = 10
const WINDOW_MS = 10 * 60 * 1000

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

function getIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'
}

/** Crude HTML → text fallback. Real parser would be too heavy for v1. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Parse "Name <email@x.com>" → { name, email }. */
function parseAddress(raw: string | null | undefined): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null }
  const m = raw.match(/^([^<]+?)\s*<([^>]+)>$/)
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() }
  if (raw.includes('@')) return { name: null, email: raw.trim() }
  return { name: raw.trim(), email: null }
}

interface NormalisedEmail {
  from: string | null
  fromName: string | null
  subject: string
  body: string
  attachments: Array<{ name: string; size?: number; mime?: string }>
}

/**
 * Pull common fields from whatever JSON shape the sender used. Tolerant of
 * extra keys, missing keys, alternate casing — anything reasonable works.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(body: any): NormalisedEmail {
  // From / sender — try Mailgun, Postmark, generic
  const rawFrom = body.sender ?? body.From ?? body.from ?? body.fromName ?? null
  const { name: fromName, email: from } = parseAddress(rawFrom)

  // Subject
  const subject = String(body.subject ?? body.Subject ?? body.Title ?? '').trim()

  // Body — prefer plain, fall back to HTML stripped
  let bodyText = String(
    body['body-plain'] ?? body.TextBody ?? body['stripped-text'] ?? body.text ?? body.body ?? ''
  ).trim()
  if (!bodyText) {
    const html = String(body['body-html'] ?? body.HtmlBody ?? body.html ?? '')
    if (html) bodyText = htmlToText(html)
  }

  // Attachments — Mailgun gives an array of {url, name, size, content-type}
  // Postmark gives `Attachments: [{Name, ContentType, ContentLength}]`
  // We just record metadata; downloading the bytes is a v2 feature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAtt = body.attachments ?? body.Attachments ?? []
  const attachments = Array.isArray(rawAtt)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? rawAtt.map((a: any) => ({
        name: String(a.name ?? a.Name ?? a.filename ?? 'attachment'),
        size: a.size ?? a.ContentLength ?? a.size_bytes ?? undefined,
        mime: a['content-type'] ?? a.ContentType ?? a.mime ?? undefined,
      }))
    : []

  return { from, fromName, subject, body: bodyText, attachments }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ip = getIp(req)

  // Rate limit early.
  if (!rateLimit(`${token}:${ip}`)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Parse body — accept JSON or form-encoded (Mailgun can send either).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawBody: any = null
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      rawBody = await req.json()
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      rawBody = Object.fromEntries(form.entries())
    } else {
      // Try JSON as last resort.
      const text = await req.text()
      try { rawBody = JSON.parse(text) } catch { rawBody = { body: text } }
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const email = normalise(rawBody)

  const supabase = createAdminSupabaseClient()

  // Verify token matches a project.
  const { data: project } = await supabase
    .from('projects')
    .select('id, code, name, created_by, workspace:workspaces(org_id)')
    .eq('inbound_token', token)
    .single()

  if (!project) {
    // Log to inbound_emails even when token invalid? No — we don't have a
    // project_id to attach it to. Just 404 silently.
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
  }

  // Email-to-task is a paid feature (gated at token-generation time), but an
  // org can downgrade after generating one — re-check here so a stale token
  // on a downgraded workspace stops silently creating tasks.
  const orgId = (project.workspace as unknown as { org_id: string } | null)?.org_id
  const { data: org } = orgId
    ? await supabase.from('organizations').select('plan').eq('id', orgId).single()
    : { data: null }
  if (!limitsFor(org?.plan).inboundEmail) {
    return NextResponse.json({ error: 'Esta dirección ya no está disponible.' }, { status: 403 })
  }

  // Validate basic content. Empty emails get logged but not turned into tasks.
  const subject = email.subject || (email.body ? email.body.slice(0, 80) : '')
  if (!subject) {
    await supabase.from('inbound_emails').insert({
      project_id: project.id,
      from_email: email.from,
      from_name: email.fromName,
      subject: '',
      body_text: email.body,
      attachments: email.attachments,
      rejection_reason: 'Empty subject and body',
    })
    return NextResponse.json({ error: 'Missing subject and body' }, { status: 400 })
  }

  // Compose the task description: original body + metadata footer.
  let description = email.body || ''
  if (email.attachments.length > 0) {
    description += '\n\n─── Adjuntos ───\n' +
      email.attachments.map(a => `📎 ${a.name}${a.size ? ` (${Math.round(a.size / 1024)} KB)` : ''}`).join('\n')
  }
  description += `\n\n─── Origen ───\nDe: ${email.fromName ? `${email.fromName} <${email.from}>` : (email.from ?? 'desconocido')}\nRecibido vía email-to-task`

  // Create the task.
  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .insert({
      project_id: project.id,
      title: subject.slice(0, 200),
      description: description.slice(0, 10_000),
      reporter_id: project.created_by,
      priority: 'medium' as const,
      status: 'todo' as const,
      position: Date.now(),
    })
    .select('id')
    .single()

  // Always log the inbound email.
  await supabase.from('inbound_emails').insert({
    project_id: project.id,
    from_email: email.from,
    from_name: email.fromName,
    subject: subject.slice(0, 500),
    body_text: email.body.slice(0, 10_000),
    attachments: email.attachments,
    created_task_id: task?.id ?? null,
    rejection_reason: taskErr ? `Task creation failed: ${taskErr.message}` : null,
  })

  if (taskErr) {
    console.error('[email.inbound] task creation failed', taskErr)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    task_id: task!.id,
    message: `Task created in ${project.code}`,
  })
}
