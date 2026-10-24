import { createAdminSupabaseClient } from '@/lib/supabase'
import { appBaseUrl } from '@/lib/mailer'
import { escapeHtml } from '@/lib/email-templates'
import { parseScope, verifyUnsubscribeToken, type UnsubscribeScope } from '@/lib/email-unsub'

/**
 * Unsubscribe from Faro emails — public (no session: the person is clicking from their inbox) but token-gated.
 *
 *   GET   shows a confirmation page. It changes NOTHING, so mail scanners that fetch every link are harmless.
 *   POST  does it. Two callers: the confirmation form (u, t, scope in the body) and the RFC 8058
 *         "one-click" request mail clients send for the List-Unsubscribe header (u, t, scope in the URL,
 *         body `List-Unsubscribe=One-Click`).
 *
 * The token is an HMAC of the user id with AUTH_SECRET (src/lib/email-unsub.ts); it can only ever switch email OFF.
 */

export const dynamic = 'force-dynamic'

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
}

function page(title: string, bodyHtml: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#F7F4EF;color:#0A1A26;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
  main{width:100%;max-width:440px;background:#fff;border:1px solid #E0D9CE;border-radius:14px;padding:28px}
  .brand{font-weight:800;letter-spacing:-.03em;font-size:20px;margin:0 0 18px}.brand span{color:#FFB020}
  h1{font-size:22px;line-height:1.2;letter-spacing:-.02em;margin:0 0 10px}
  p{margin:0 0 16px;color:#243743}
  button,a.btn{display:block;width:100%;box-sizing:border-box;text-align:center;font:inherit;font-weight:700;border-radius:10px;padding:13px 16px;margin:0 0 10px;cursor:pointer;text-decoration:none}
  .primary{background:#FFB020;color:#0A1A26;border:0}
  .secondary{background:transparent;color:#0A1A26;border:1px solid #E0D9CE}
  small{color:#55636B}
  @media (prefers-color-scheme:dark){
    body{background:#0A1A26;color:#F7F4EF}main{background:#12293A;border-color:#1E3A4C}p{color:#D6DEE3}
    .secondary{color:#F7F4EF;border-color:#1E3A4C}small{color:#9DB0BC}
  }
</style></head>
<body><main><p class="brand"><span>&#9650;</span>&nbsp;Faro</p>${bodyHtml}</main></body></html>`
  return new Response(html, { status, headers: HEADERS })
}

const prefsLink = () => `<a class="btn secondary" href="${escapeHtml(appBaseUrl())}/dashboard/ajustes-avisos">Cambiar mis preferencias</a>`

function invalid() {
  return page(
    'Enlace no válido',
    `<h1>Este enlace no es válido</h1><p>Puede haberse copiado incompleto. Entra a Faro y desactiva los correos desde <strong>Avisos</strong>.</p>${prefsLink()}`,
    400,
  )
}

function readParams(url: URL, form?: FormData | null) {
  const pick = (k: string) => url.searchParams.get(k) ?? (form?.get(k) as string | null) ?? ''
  return { userId: pick('u'), token: pick('t'), scope: parseScope(pick('scope')) }
}

export async function GET(req: Request) {
  const { userId, token, scope } = readParams(new URL(req.url))
  if (!verifyUnsubscribeToken(userId, token, process.env.AUTH_SECRET)) return invalid()

  const field = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`
  return page(
    'Dejar de recibir correos de Faro',
    `<h1>¿Dejar de recibir correos de Faro?</h1>
<p>Elige qué quieres apagar. Puedes volver a activarlo cuando quieras desde <strong>Avisos</strong> dentro de Faro.</p>
<form method="post" action="/api/email/unsubscribe">
  ${field('u', userId)}${field('t', token)}
  <button class="primary" type="submit" name="scope" value="digest">Dejar de recibir el resumen</button>
  <button class="secondary" type="submit" name="scope" value="all">Dejar de recibir todos los correos</button>
</form>
${prefsLink()}
<small>${scope === 'all' ? 'Este enlace venía de un aviso: lo habitual es apagar todos los correos.' : 'Tus avisos en la app y en el teléfono no cambian.'}</small>`,
  )
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  let form: FormData | null = null
  try {
    form = await req.formData()
  } catch {
    /* one-click requests may carry a body we do not need */
  }
  const { userId, token, scope } = readParams(url, form)
  if (!verifyUnsubscribeToken(userId, token, process.env.AUTH_SECRET)) return invalid()

  const patch: { email_digest: 'off'; email_instant?: false } = { email_digest: 'off' }
  if (scope === 'all') patch.email_instant = false
  const { error } = await createAdminSupabaseClient()
    .from('user_notification_prefs')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'unsubscribe failed', code: error.code ?? null }))
    return page(
      'No se pudo guardar',
      `<h1>No pudimos guardar el cambio</h1><p>Inténtalo de nuevo en un momento, o entra a Faro y desactiva los correos desde <strong>Avisos</strong>.</p>${prefsLink()}`,
      500,
    )
  }
  const what: Record<UnsubscribeScope, string> = {
    digest: 'Ya no te enviaremos el resumen por correo.',
    all: 'Ya no te enviaremos correos de Faro.',
  }
  return page('Listo', `<h1>Listo</h1><p>${what[scope]}</p><p><small>Tus avisos dentro de la app y en el teléfono siguen igual.</small></p>${prefsLink()}`)
}
