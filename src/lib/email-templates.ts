import { daysBetween, addDays } from '@/lib/tz'
import { weekdayOf } from '@/lib/email-schedule'
import { taskCount, type DigestBucket, type DigestData, type DigestGroup } from '@/lib/email-digest-core'

/**
 * Email templates — pure functions, no I/O.
 *
 * Email HTML is a hostile environment (Outlook's Word engine, Gmail clipping, forced dark modes), so:
 * tables for layout, inline styles, 600px, a bulletproof button, a hidden preheader, a plain-text
 * alternative built from the SAME blocks (not scraped from the HTML), and every piece of text that came
 * from a person (task titles, names, project names) goes through `escapeHtml`. Links are restricted
 * to http(s) or paths inside the app.
 */

const C = {
  night: '#0A1A26',
  night700: '#12293A',
  signal: '#FFB020',
  signalInk: '#C67A08',
  mist: '#F7F4EF',
  stone: '#E0D9CE',
  graphite: '#55636B',
  body: '#243743',
  danger: '#C8453A',
  white: '#FFFFFF',
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif"
const DISPLAY = `Archivo, ${SANS}`
const MONO = "'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace"

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** http(s) URLs pass; paths resolve against the app; anything else (javascript:, data:, …) collapses to the app root. */
export function safeLink(url: string | null | undefined, baseUrl: string): string {
  if (!url) return baseUrl
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('/') && !u.startsWith('//')) return `${baseUrl}${u}`
  return baseUrl
}

const safeColor = (c: string | null | undefined, fallback: string) => (c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback)

// ── Spanish dates (own tables: no dependence on the ICU data of the runtime) ──────────────────

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

/** 'jueves 22 de octubre' */
export function formatDateEs(iso: string): string {
  const { m, d } = parts(iso)
  return `${DAYS[weekdayOf(iso)]} ${d} de ${MONTHS[m - 1]}`
}

/** '22 oct' */
export function formatShortDateEs(iso: string): string {
  const { m, d } = parts(iso)
  return `${d} ${MONTHS_SHORT[m - 1]}`
}

/** 'del 26 al 1 de noviembre' / 'del 26 de octubre al 1 de noviembre' */
export function rangeLabelEs(startIso: string, endIso: string): string {
  const a = parts(startIso)
  const b = parts(endIso)
  if (a.m === b.m && a.y === b.y) return `del ${a.d} al ${b.d} de ${MONTHS[b.m - 1]}`
  return `del ${a.d} de ${MONTHS[a.m - 1]} al ${b.d} de ${MONTHS[b.m - 1]}`
}

/** 'Vence hoy' · 'Vence mañana' · 'Venció hace 3 días' · 'Vence vie 24 oct' */
export function dueLabelEs(due: string, todayIso: string): string {
  const diff = daysBetween(todayIso, due) // positive = future
  if (diff === 0) return 'Vence hoy'
  if (diff === 1) return 'Vence mañana'
  if (diff === -1) return 'Venció ayer'
  if (diff < 0) return diff >= -14 ? `Venció hace ${-diff} días` : `Venció el ${formatShortDateEs(due)}`
  return `Vence ${DAYS_SHORT[weekdayOf(due)]} ${formatShortDateEs(due)}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// ── Block model → HTML + text ────────────────────────────────────────────────────────────────

export type EmailBlock =
  | { type: 'p'; text: string }
  | { type: 'section'; label: string; tone: 'danger' | 'signal' | 'muted'; count?: number }
  | { type: 'group'; title: string; subtitle?: string | null; color?: string | null }
  | { type: 'item'; title: string; meta?: string | null; url?: string | null }
  | { type: 'more'; text: string }

export interface EmailDoc {
  /** Short line shown next to the subject in the inbox list. */
  preheader: string
  heading: string
  blocks: EmailBlock[]
  cta?: { label: string; url: string }
  /** Why the person is getting this email. */
  reason?: string
  footerLinks: Array<{ label: string; url: string }>
  baseUrl: string
}

const TONE: Record<'danger' | 'signal' | 'muted', string> = { danger: C.danger, signal: C.signalInk, muted: C.graphite }

function htmlBlock(b: EmailBlock, base: string): string {
  switch (b.type) {
    case 'p':
      return `<tr><td class="t-body" style="padding:0 28px 14px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.body}">${escapeHtml(b.text)}</td></tr>`
    case 'section':
      return `<tr><td style="padding:22px 28px 4px;font-family:${MONO};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${TONE[b.tone]}">${escapeHtml(b.label)}${b.count !== undefined ? ` · ${b.count}` : ''}</td></tr>`
    case 'group':
      return `<tr><td class="t-main" style="padding:12px 28px 2px;font-family:${SANS};font-size:13px;font-weight:700;color:${C.night}"><span style="color:${safeColor(b.color, C.graphite)};font-size:11px">&#9679;</span>&nbsp;${escapeHtml(b.title)}${b.subtitle ? ` <span class="t-muted" style="font-weight:400;color:${C.graphite}">&middot; ${escapeHtml(b.subtitle)}</span>` : ''}</td></tr>`
    case 'item': {
      const title = b.url
        ? `<a class="t-main" href="${escapeHtml(safeLink(b.url, base))}" style="color:${C.night};text-decoration:none;font-weight:600">${escapeHtml(b.title)}</a>`
        : `<span class="t-main" style="color:${C.night};font-weight:600">${escapeHtml(b.title)}</span>`
      return `<tr><td style="padding:6px 28px 6px 44px;font-family:${SANS};font-size:15px;line-height:1.4;color:${C.night}">${title}${b.meta ? `<br><span class="t-muted" style="font-size:13px;color:${C.graphite}">${escapeHtml(b.meta)}</span>` : ''}</td></tr>`
    }
    case 'more':
      return `<tr><td class="t-muted" style="padding:6px 28px 6px 44px;font-family:${SANS};font-size:13px;color:${C.graphite}">${escapeHtml(b.text)}</td></tr>`
  }
}

function textBlock(b: EmailBlock, base: string): string {
  switch (b.type) {
    case 'p':
      return `${b.text}\n`
    case 'section':
      return `\n${b.label.toUpperCase()}${b.count !== undefined ? ` (${b.count})` : ''}`
    case 'group':
      return `\n${b.title}${b.subtitle ? ` · ${b.subtitle}` : ''}`
    case 'item':
      return `- ${b.title}${b.meta ? ` — ${b.meta}` : ''}${b.url ? `\n  ${safeLink(b.url, base)}` : ''}`
    case 'more':
      return `  ${b.text}`
  }
}

export function renderEmail(doc: EmailDoc): { html: string; text: string } {
  const base = doc.baseUrl
  const ctaUrl = doc.cta ? safeLink(doc.cta.url, base) : null

  const button = doc.cta && ctaUrl
    ? `<tr><td style="padding:26px 28px 8px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.signal}" style="border-radius:10px;background:${C.signal}"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:700;color:${C.night};text-decoration:none;border-radius:10px">${escapeHtml(doc.cta.label)}</a></td></tr></table></td></tr>`
    : ''

  const footerLinks = doc.footerLinks
    .map(l => `<a href="${escapeHtml(safeLink(l.url, base))}" style="color:${C.graphite};text-decoration:underline">${escapeHtml(l.label)}</a>`)
    .join(' &nbsp;&middot;&nbsp; ')

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(doc.heading)}</title>
<style>
  body{margin:0;padding:0}
  a{color:inherit}
  @media (prefers-color-scheme: dark){
    .bg-page{background:${C.night}!important}
    .bg-card{background:${C.night700}!important;border-color:#1E3A4C!important}
    .t-main,.t-main a{color:${C.mist}!important}
    .t-body{color:#D6DEE3!important}
    .t-muted,.t-muted a{color:#9DB0BC!important}
  }
  @media (max-width:620px){ .wrap{width:100%!important} }
</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background:${C.mist}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(doc.preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" style="background:${C.mist}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">
    <tr><td style="padding:0 4px 14px;font-family:${DISPLAY};font-size:20px;font-weight:800;letter-spacing:-0.03em;color:${C.night}" class="t-main"><span style="color:${C.signal}">&#9650;</span>&nbsp;Faro</td></tr>
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-card" style="background:${C.white};border:1px solid ${C.stone};border-radius:14px">
        <tr><td class="t-main" style="padding:28px 28px 8px;font-family:${DISPLAY};font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;color:${C.night}">${escapeHtml(doc.heading)}</td></tr>
        ${doc.blocks.map(b => htmlBlock(b, base)).join('\n        ')}
        ${button}
        <tr><td style="padding:0 28px 24px"></td></tr>
      </table>
    </td></tr>
    <tr><td class="t-muted" style="padding:16px 8px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.graphite}">${doc.reason ? `${escapeHtml(doc.reason)}<br>` : ''}${footerLinks}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`

  const text = [
    'FARO',
    doc.heading,
    '',
    ...doc.blocks.map(b => textBlock(b, base)),
    ...(doc.cta && ctaUrl ? ['', `${doc.cta.label}: ${ctaUrl}`] : []),
    '',
    '--',
    ...(doc.reason ? [doc.reason] : []),
    ...doc.footerLinks.map(l => `${l.label}: ${safeLink(l.url, base)}`),
  ].join('\n')

  return { html, text }
}

// ── The emails Faro sends ────────────────────────────────────────────────────────────────────

export interface EmailLinks {
  baseUrl: string
  /** Signed one-click unsubscribe URL, or null when the server has no secret to sign with. */
  unsubscribeUrl: string | null
}

export interface BuiltEmail {
  subject: string
  html: string
  text: string
  /** RFC 8058 headers; empty when there is no unsubscribe link. */
  headers: Record<string, string>
}

export function unsubscribeHeaders(url: string | null): Record<string, string> {
  return url ? { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || ''

function bucketBlocks(
  bucket: DigestBucket,
  label: string,
  tone: 'danger' | 'signal' | 'muted',
  todayIso: string,
): EmailBlock[] {
  if (!bucket.total) return []
  const blocks: EmailBlock[] = [{ type: 'section', label, tone, count: bucket.total }]
  for (const g of bucket.groups as DigestGroup[]) {
    blocks.push({ type: 'group', title: g.empresa, subtitle: g.hat, color: g.color })
    for (const it of g.items) {
      blocks.push({ type: 'item', title: it.title, meta: [dueLabelEs(it.due, todayIso), it.project].filter(Boolean).join(' · '), url: it.url })
    }
  }
  if (bucket.more > 0) blocks.push({ type: 'more', text: `y ${plural(bucket.more, 'tarea más', 'tareas más')} en Faro` })
  return blocks
}

/** "Tu día en Faro · jueves 22 de octubre · 3 tareas" */
export function digestSubject(d: DigestData): string {
  const n = taskCount(d)
  const when = d.mode === 'weekly' ? `Tu semana en Faro · ${rangeLabelEs(d.todayIso, d.weekEndIso)}` : `Tu día en Faro · ${formatDateEs(d.todayIso)}`
  if (n > 0) return `${when} · ${plural(n, 'tarea', 'tareas')}`
  if (d.approvals.length > 0) return `${when} · ${plural(d.approvals.length, 'pendiente de revisión', 'pendientes de revisión')}`
  if (d.unread.total > 0) return `${when} · ${plural(d.unread.total, 'aviso sin leer', 'avisos sin leer')}`
  return when
}

export function buildDigestEmail(d: DigestData, links: EmailLinks): BuiltEmail {
  const { baseUrl } = links
  const hi = firstName(d.name)
  const summary: string[] = []
  if (d.overdue.total) summary.push(plural(d.overdue.total, 'atrasada', 'atrasadas'))
  if (d.today.total) summary.push(`${plural(d.today.total, 'vence hoy', 'vencen hoy')}`)
  if (d.week.total) summary.push(`${d.week.total} ${d.mode === 'weekly' ? 'esta semana' : 'más esta semana'}`)

  const blocks: EmailBlock[] = [
    { type: 'p', text: `${hi ? `Hola ${hi}. ` : 'Hola. '}${d.mode === 'weekly' ? 'Esto es lo que tienes entre hoy y el domingo.' : 'Esto es lo que tienes por delante.'}` },
    ...(summary.length ? [{ type: 'p', text: summary.join(' · ') } as EmailBlock] : []),
    ...bucketBlocks(d.overdue, 'Atrasadas', 'danger', d.todayIso),
    ...bucketBlocks(d.today, 'Hoy', 'signal', d.todayIso),
    ...bucketBlocks(d.week, 'Esta semana', 'muted', d.todayIso),
  ]
  if (d.approvals.length) {
    blocks.push({ type: 'section', label: 'Esperan tu revisión', tone: 'signal', count: d.approvals.length })
    for (const a of d.approvals) blocks.push({ type: 'item', title: a.title, meta: a.label, url: a.url })
  }
  if (d.unread.total) {
    blocks.push({ type: 'section', label: 'Sin leer en tu bandeja', tone: 'muted', count: d.unread.total })
    for (const u of d.unread.items) blocks.push({ type: 'item', title: u.title, meta: u.body, url: u.url })
    if (d.unread.total > d.unread.items.length) blocks.push({ type: 'more', text: `y ${d.unread.total - d.unread.items.length} más en tu bandeja` })
  }

  const subject = digestSubject(d)
  const n = taskCount(d)
  const { html, text } = renderEmail({
    preheader: n > 0 ? summary.join(' · ') : 'Hay cosas que esperan tu atención.',
    heading: d.mode === 'weekly' ? `Tu semana, ${rangeLabelEs(d.todayIso, d.weekEndIso)}` : `Tu día, ${formatDateEs(d.todayIso)}`,
    blocks,
    cta: { label: 'Abrir Faro', url: '/dashboard' },
    reason: `Recibes este ${d.mode === 'weekly' ? 'resumen semanal' : 'resumen diario'} porque lo activaste en Faro. Si no hay nada pendiente, no te escribimos.`,
    footerLinks: [
      { label: 'Cambiar preferencias', url: '/dashboard/ajustes-avisos' },
      ...(links.unsubscribeUrl ? [{ label: 'Dejar de recibir este resumen', url: links.unsubscribeUrl }] : []),
    ],
    baseUrl,
  })
  return { subject, html, text, headers: unsubscribeHeaders(links.unsubscribeUrl) }
}

export function buildInstantEmail(
  input: { name: string; kindLabel: string; title: string; body?: string | null; url?: string | null },
  links: EmailLinks,
): BuiltEmail {
  const hi = firstName(input.name)
  const blocks: EmailBlock[] = [
    ...(hi ? [{ type: 'p', text: `Hola ${hi}.` } as EmailBlock] : []),
    ...(input.body ? [{ type: 'p', text: input.body } as EmailBlock] : []),
  ]
  const { html, text } = renderEmail({
    preheader: input.body?.slice(0, 120) || input.title,
    heading: input.title,
    blocks,
    cta: { label: 'Abrir en Faro', url: input.url || '/dashboard/bandeja' },
    reason: `Te escribimos porque activaste los avisos por correo de «${input.kindLabel}».`,
    footerLinks: [
      { label: 'Cambiar preferencias', url: '/dashboard/ajustes-avisos' },
      ...(links.unsubscribeUrl ? [{ label: 'Dejar de recibir avisos por correo', url: links.unsubscribeUrl }] : []),
    ],
    baseUrl: links.baseUrl,
  })
  return { subject: input.title.slice(0, 150), html, text, headers: unsubscribeHeaders(links.unsubscribeUrl) }
}

/** "Send me a test": a small sample of the digest so the person sees how it will look. */
export function buildTestEmail(name: string, todayIso: string, links: EmailLinks): BuiltEmail {
  const hi = firstName(name)
  const { html, text } = renderEmail({
    preheader: 'Si ves este correo, el envío de Faro funciona.',
    heading: 'Correo de prueba',
    blocks: [
      { type: 'p', text: `${hi ? `Hola ${hi}. ` : ''}Si ves este correo, el envío de Faro funciona. Así se verá tu resumen (los datos de abajo son de ejemplo).` },
      { type: 'section', label: 'Hoy', tone: 'signal', count: 2 },
      { type: 'group', title: 'Mesa Inteligente', subtitle: 'Administración', color: '#8C5BA8' },
      { type: 'item', title: 'Conciliar banco de octubre', meta: `${dueLabelEs(todayIso, todayIso)} · Cierre mensual`, url: '/dashboard' },
      { type: 'item', title: 'Pagar proveedores', meta: `${dueLabelEs(addDays(todayIso, 1), todayIso)} · Compras`, url: '/dashboard' },
    ],
    cta: { label: 'Abrir Faro', url: '/dashboard' },
    reason: 'Pediste este correo de prueba desde Avisos.',
    footerLinks: [{ label: 'Cambiar preferencias', url: '/dashboard/ajustes-avisos' }],
    baseUrl: links.baseUrl,
  })
  return { subject: 'Faro: correo de prueba', html, text, headers: {} }
}
