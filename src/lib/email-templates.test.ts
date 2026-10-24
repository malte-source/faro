import { describe, expect, it } from 'vitest'
import {
  buildDigestEmail,
  buildInstantEmail,
  buildTestEmail,
  digestSubject,
  dueLabelEs,
  escapeHtml,
  formatDateEs,
  rangeLabelEs,
  renderEmail,
  safeLink,
  unsubscribeHeaders,
} from './email-templates'
import { emptyBucket, type DigestData } from './email-digest-core'

const BASE = 'https://faro.example'
const LINKS = { baseUrl: BASE, unsubscribeUrl: `${BASE}/api/email/unsubscribe?u=U&t=T` }

const digest = (over: Partial<DigestData> = {}): DigestData => ({
  name: 'Malte Melgarejo',
  mode: 'daily',
  todayIso: '2026-10-22',
  weekEndIso: '2026-10-25',
  overdue: {
    total: 1,
    more: 0,
    groups: [{ empresa: 'TPY', color: '#3E7CB1', hat: 'Dirección', items: [{ title: 'Cerrar el mes', due: '2026-10-20', project: 'Finanzas', url: '/dashboard/projects/p1' }] }],
  },
  today: {
    total: 2,
    more: 1,
    groups: [{ empresa: 'Mesa Inteligente', color: '#8C5BA8', hat: 'Administración', items: [{ title: 'Pagar proveedores', due: '2026-10-22', project: 'Compras', url: '/dashboard/projects/p2' }] }],
  },
  week: emptyBucket(),
  approvals: [{ title: 'Manual Técnico v1', label: 'documento', url: '/dashboard/documentos/d1' }],
  unread: { total: 3, items: [{ title: 'Te asignaron una tarea', body: 'Revisar contrato', url: '/dashboard/bandeja' }] },
  ...over,
})

describe('dates in Spanish', () => {
  it('formats without ICU', () => {
    expect(formatDateEs('2026-10-22')).toBe('jueves 22 de octubre')
    expect(formatDateEs('2026-11-01')).toBe('domingo 1 de noviembre')
  })
  it('range labels', () => {
    expect(rangeLabelEs('2026-10-26', '2026-11-01')).toBe('del 26 de octubre al 1 de noviembre')
    expect(rangeLabelEs('2026-11-02', '2026-11-08')).toBe('del 2 al 8 de noviembre')
  })
  it('due labels', () => {
    const t = '2026-10-22'
    expect(dueLabelEs('2026-10-22', t)).toBe('Vence hoy')
    expect(dueLabelEs('2026-10-23', t)).toBe('Vence mañana')
    expect(dueLabelEs('2026-10-21', t)).toBe('Venció ayer')
    expect(dueLabelEs('2026-10-19', t)).toBe('Venció hace 3 días')
    expect(dueLabelEs('2026-09-01', t)).toBe('Venció el 1 sep')
    expect(dueLabelEs('2026-10-24', t)).toBe('Vence sáb 24 oct')
  })
})

describe('escaping and links', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;')
  })
  it('only lets http(s) and in-app paths through', () => {
    expect(safeLink('https://a.co/x', BASE)).toBe('https://a.co/x')
    expect(safeLink('/dashboard/chat?c=1', BASE)).toBe(`${BASE}/dashboard/chat?c=1`)
    expect(safeLink('javascript:alert(1)', BASE)).toBe(BASE)
    expect(safeLink('data:text/html;base64,AAA', BASE)).toBe(BASE)
    expect(safeLink('//evil.co/x', BASE)).toBe(BASE) // protocol-relative must not escape the app
    expect(safeLink(null, BASE)).toBe(BASE)
  })
})

describe('buildDigestEmail', () => {
  it('escapes everything a person typed (task title, name, project, empresa) in the HTML', () => {
    const evil = `<img src=x onerror=alert(1)>`
    const d = digest({
      name: `<b>${evil}`,
      today: { total: 1, more: 0, groups: [{ empresa: evil, color: 'red;background:url(x)', hat: evil, items: [{ title: evil, due: '2026-10-22', project: evil, url: 'javascript:alert(1)' }] }] },
    })
    const { html } = buildDigestEmail(d, LINKS)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b><img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('background:url(x)') // an invalid empresa colour falls back instead of being injected
  })

  it('has a Señal button, a preheader, dark-mode support and the footer links', () => {
    const { html } = buildDigestEmail(digest(), LINKS)
    expect(html).toContain('Abrir Faro')
    expect(html).toContain('#FFB020') // Señal
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('name="color-scheme"')
    expect(html).toContain('max-height:0') // hidden preheader
    expect(html).toContain('Dejar de recibir este resumen')
    expect(html).toContain('Cambiar preferencias')
    expect(html).toContain(`${BASE}/dashboard/ajustes-avisos`)
    expect(html.match(/width="600"/g)?.length).toBe(1)
  })

  it('builds a plain-text alternative with the content and absolute links', () => {
    const { text } = buildDigestEmail(digest(), LINKS)
    expect(text).toContain('ATRASADAS (1)')
    expect(text).toContain('HOY (2)')
    expect(text).toContain('TPY · Dirección')
    expect(text).toContain('- Cerrar el mes — Venció hace 2 días · Finanzas')
    expect(text).toContain(`${BASE}/dashboard/projects/p1`)
    expect(text).toContain(`Abrir Faro: ${BASE}/dashboard`)
    expect(text).toContain('y 1 tarea más en Faro')
    expect(text).toContain('ESPERAN TU REVISIÓN (1)')
    expect(text).not.toMatch(/<[a-z]/i) // no HTML tags leak into the text part
  })

  it('shows the cargo next to the empresa', () => {
    const { html } = buildDigestEmail(digest(), LINKS)
    expect(html).toContain('Mesa Inteligente')
    expect(html).toContain('Administración')
  })

  it('adds List-Unsubscribe headers only when there is a signed link', () => {
    expect(buildDigestEmail(digest(), LINKS).headers).toEqual({
      'List-Unsubscribe': `<${LINKS.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    const noSecret = buildDigestEmail(digest(), { baseUrl: BASE, unsubscribeUrl: null })
    expect(noSecret.headers).toEqual({})
    expect(noSecret.html).not.toContain('Dejar de recibir este resumen')
    expect(noSecret.html).toContain('Cambiar preferencias')
  })

  it('weekly digests say "semana" and the date range', () => {
    const d = digest({ mode: 'weekly', todayIso: '2026-10-26', weekEndIso: '2026-11-01', today: emptyBucket() })
    const built = buildDigestEmail(d, LINKS)
    expect(built.subject).toContain('Tu semana en Faro · del 26 de octubre al 1 de noviembre')
    expect(built.html).toContain('resumen semanal')
  })
})

describe('digestSubject', () => {
  it('daily: "Tu día en Faro · jueves 22 de octubre · 3 tareas"', () => {
    expect(digestSubject(digest())).toBe('Tu día en Faro · jueves 22 de octubre · 3 tareas')
  })
  it('singular', () => {
    expect(digestSubject(digest({ today: emptyBucket(), overdue: { ...digest().overdue, total: 1 } }))).toBe('Tu día en Faro · jueves 22 de octubre · 1 tarea')
  })
  it('without tasks it falls back to approvals, then unread notifications', () => {
    const none = { overdue: emptyBucket(), today: emptyBucket(), week: emptyBucket() }
    expect(digestSubject(digest({ ...none }))).toBe('Tu día en Faro · jueves 22 de octubre · 1 pendiente de revisión')
    expect(digestSubject(digest({ ...none, approvals: [] }))).toBe('Tu día en Faro · jueves 22 de octubre · 3 avisos sin leer')
  })
})

describe('instant and test emails', () => {
  it('instant: title is the subject, escaped, with an in-app link and the reason', () => {
    const b = buildInstantEmail({ name: 'Ana', kindLabel: 'Documentos por revisar', title: 'Te pidieron revisar <Manual>', body: 'Manual Técnico v1', url: '/dashboard/documentos/d1' }, LINKS)
    expect(b.subject).toBe('Te pidieron revisar <Manual>') // subjects are plain text, not HTML
    expect(b.html).toContain('Te pidieron revisar &lt;Manual&gt;')
    expect(b.html).not.toContain('<Manual>')
    expect(b.html).toContain(`${BASE}/dashboard/documentos/d1`)
    expect(b.html).toContain('Documentos por revisar')
    expect(b.html).toContain('Dejar de recibir avisos por correo')
    expect(b.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
  it('instant without a url opens the inbox', () => {
    expect(buildInstantEmail({ name: 'A', kindLabel: 'x', title: 'Hola' }, LINKS).html).toContain(`${BASE}/dashboard/bandeja`)
  })
  it('test email has no unsubscribe (it is not a subscription)', () => {
    const b = buildTestEmail('Malte', '2026-10-22', LINKS)
    expect(b.subject).toBe('Faro: correo de prueba')
    expect(b.headers).toEqual({})
    expect(b.html).toContain('de ejemplo')
  })
})

describe('renderEmail', () => {
  it('works with no blocks, no button and no footer links', () => {
    const { html, text } = renderEmail({ preheader: 'p', heading: 'Hola', blocks: [], footerLinks: [], baseUrl: BASE })
    expect(html).toContain('Hola')
    expect(text).toContain('Hola')
  })
  it('unsubscribeHeaders is empty for null', () => {
    expect(unsubscribeHeaders(null)).toEqual({})
  })
})
