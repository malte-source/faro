import nodemailer from 'nodemailer'

/**
 * Outgoing email through Google Workspace SMTP (an App Password of a real mailbox).
 *
 *   SMTP_HOST   smtp.gmail.com (default)
 *   SMTP_PORT   587 (STARTTLS, default) or 465 (implicit TLS). Cloud Run blocks 25.
 *   SMTP_USER   the mailbox, e.g. faro@thecrewagencia.com
 *   SMTP_PASS   its 16-character App Password (spaces are ignored)
 *   EMAIL_FROM  'Faro <faro@thecrewagencia.com>' (defaults to SMTP_USER)
 *   APP_BASE_URL | AUTH_URL   public URL used in email links (read at RUNTIME; NEXT_PUBLIC_* is baked at build)
 *
 * Contract: nothing here ever throws. With SMTP_USER / SMTP_PASS missing every send is a
 * logged no-op (`email_disabled`) so the rest of the product keeps working until the secret exists.
 */

export interface EmailConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

const DEFAULT_APP_URL = 'https://faro-app-303070777698.southamerica-east1.run.app'

export function readEmailConfig(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const user = env.SMTP_USER?.trim()
  // Google shows app passwords as "abcd efgh ijkl mnop": the spaces are decoration.
  const pass = env.SMTP_PASS?.replace(/\s+/g, '')
  if (!user || !pass) return null
  const port = Number(env.SMTP_PORT) > 0 ? Number(env.SMTP_PORT) : 587
  const from = env.EMAIL_FROM?.trim() || `Faro <${user}>`
  return { host: env.SMTP_HOST?.trim() || 'smtp.gmail.com', port, user, pass, from }
}

export const isEmailConfigured = (env: Record<string, string | undefined> = process.env) => readEmailConfig(env) !== null

/** Public base URL for links inside emails, without a trailing slash. */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.APP_BASE_URL?.trim() || env.AUTH_URL?.trim() || DEFAULT_APP_URL
  return raw.replace(/\/+$/, '')
}

export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}

/** The slice of nodemailer's transport this module needs — lets tests inject a fake. */
export interface MailTransport {
  sendMail(message: {
    from: string
    to: string
    subject: string
    html: string
    text: string
    headers?: Record<string, string>
  }): Promise<{ messageId?: string }>
}

export type MailResult =
  | { ok: true; messageId?: string; attempts: number }
  | { ok: false; skipped: 'email_disabled' | 'invalid_message' }
  | { ok: false; error: string; attempts: number; transient: boolean }

export interface SendOptions {
  transport?: MailTransport
  /** `undefined` → read the environment. */
  config?: EmailConfig | null
  /** Pause before the single retry. Tests pass 0. */
  retryDelayMs?: number
  /** Label for the log line (never the address). */
  kind?: string
}

const TRANSIENT_CODES = new Set(['ECONNECTION', 'ECONNRESET', 'ETIMEDOUT', 'ETIMEOUT', 'ESOCKET', 'EDNS', 'EAI_AGAIN', 'ECONNREFUSED'])

/** Network hiccups and SMTP 4xx ("try again later") are worth one retry; auth failures and 5xx are not. */
export function isTransientMailError(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number } | null
  if (!e) return false
  if (typeof e.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500
  return !!e.code && TRANSIENT_CODES.has(e.code)
}

const ADDRESS = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/
const noLineBreaks = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

let loggedDisabled = false
const cached = new Map<string, MailTransport>()

function transportFor(config: EmailConfig): MailTransport {
  const key = `${config.host}:${config.port}:${config.user}`
  const hit = cached.get(key)
  if (hit) return hit
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  }) as unknown as MailTransport
  cached.set(key, transport)
  return transport
}

const sleep = (ms: number) => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve())

export async function sendMail(message: MailMessage, options: SendOptions = {}): Promise<MailResult> {
  const config = options.config === undefined ? readEmailConfig() : options.config
  if (!config) {
    if (!loggedDisabled) {
      loggedDisabled = true
      console.log(JSON.stringify({ severity: 'INFO', message: 'email_disabled', hint: 'SMTP_USER / SMTP_PASS not set' }))
    }
    return { ok: false, skipped: 'email_disabled' }
  }

  const to = message.to.trim()
  // One recipient per message, and nothing that could smuggle extra headers.
  if (!ADDRESS.test(to) || !message.subject.trim() || !message.html || !message.text) {
    return { ok: false, skipped: 'invalid_message' }
  }
  const headers = Object.fromEntries(
    Object.entries(message.headers ?? {}).map(([k, v]) => [noLineBreaks(k), noLineBreaks(v)]),
  )
  const payload = { from: config.from, to, subject: noLineBreaks(message.subject), html: message.html, text: message.text, headers }

  const transport = options.transport ?? transportFor(config)
  let attempts = 0
  let lastError: unknown = null
  for (let i = 0; i < 2; i++) {
    attempts++
    try {
      const info = await transport.sendMail(payload)
      return { ok: true, messageId: info?.messageId, attempts }
    } catch (err) {
      lastError = err
      if (i === 0 && isTransientMailError(err)) {
        await sleep(options.retryDelayMs ?? 1000)
        continue
      }
      break
    }
  }
  const e = lastError as { code?: string; responseCode?: number; message?: string } | null
  console.warn(JSON.stringify({
    severity: 'WARNING',
    message: 'email_send_failed',
    kind: options.kind ?? 'unknown',
    code: e?.code ?? null,
    responseCode: e?.responseCode ?? null,
    attempts,
  }))
  return {
    ok: false,
    error: e?.code ?? (e?.responseCode ? `SMTP ${e.responseCode}` : 'send_failed'),
    attempts,
    transient: isTransientMailError(lastError),
  }
}

export interface BatchOptions extends SendOptions {
  /** Messages in flight at once. Workspace SMTP is happier with a few than with a burst. */
  concurrency?: number
  /** Hard ceiling of messages attempted in one run; the rest are returned as `capped`. */
  cap?: number
}

export interface BatchResult {
  results: Array<MailResult | { ok: false; skipped: 'capped' }>
  sent: number
  failed: number
  capped: number
}

/** Send many, a few at a time, stopping at `cap`. Results line up with the input order. */
export async function sendMailBatch(messages: MailMessage[], options: BatchOptions = {}): Promise<BatchResult> {
  const concurrency = Math.max(1, options.concurrency ?? 3)
  const cap = options.cap ?? Number.POSITIVE_INFINITY
  const results: BatchResult['results'] = new Array(messages.length)
  let next = 0
  let attempted = 0

  async function worker() {
    while (true) {
      const i = next++
      if (i >= messages.length) return
      if (attempted >= cap) {
        results[i] = { ok: false, skipped: 'capped' }
        continue
      }
      attempted++
      results[i] = await sendMail(messages[i], options)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, messages.length) }, worker))

  let sent = 0, failed = 0, capped = 0
  for (const r of results) {
    if (r.ok) sent++
    else if ('skipped' in r && r.skipped === 'capped') capped++
    else if (!('skipped' in r)) failed++
  }
  return { results, sent, failed, capped }
}

/** Test seam: forget the cached transport and the one-time `email_disabled` log. */
export function resetMailerForTests() {
  cached.clear()
  loggedDisabled = false
}
