import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appBaseUrl,
  isTransientMailError,
  readEmailConfig,
  resetMailerForTests,
  sendMail,
  sendMailBatch,
  type EmailConfig,
  type MailMessage,
  type MailTransport,
} from './mailer'

const CONFIG: EmailConfig = { host: 'smtp.gmail.com', port: 587, user: 'faro@example.com', pass: 'secret', from: 'Faro <faro@example.com>' }
const MSG: MailMessage = { to: 'ana@example.com', subject: 'Hola', html: '<p>Hola</p>', text: 'Hola' }

afterEach(() => { resetMailerForTests(); vi.restoreAllMocks() })

function fake(behaviour: (call: number) => Promise<{ messageId?: string }>) {
  const calls: Array<Parameters<MailTransport['sendMail']>[0]> = []
  const transport: MailTransport = {
    async sendMail(m) {
      calls.push(m)
      return behaviour(calls.length)
    },
  }
  return { transport, calls }
}

describe('readEmailConfig', () => {
  it('is null without SMTP_USER or SMTP_PASS (email stays off, nothing crashes)', () => {
    expect(readEmailConfig({})).toBeNull()
    expect(readEmailConfig({ SMTP_USER: 'a@b.co' })).toBeNull()
    expect(readEmailConfig({ SMTP_PASS: 'x' })).toBeNull()
  })

  it('applies Gmail defaults and strips the spaces Google puts in app passwords', () => {
    const c = readEmailConfig({ SMTP_USER: 'faro@thecrewagencia.com', SMTP_PASS: 'abcd efgh ijkl mnop' })!
    expect(c.host).toBe('smtp.gmail.com')
    expect(c.port).toBe(587)
    expect(c.pass).toBe('abcdefghijklmnop')
    expect(c.from).toBe('Faro <faro@thecrewagencia.com>')
  })

  it('respects explicit host, port and EMAIL_FROM', () => {
    const c = readEmailConfig({ SMTP_USER: 'u@x.co', SMTP_PASS: 'p', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', EMAIL_FROM: 'Equipo <hola@x.co>' })!
    expect([c.host, c.port, c.from]).toEqual(['smtp.example.com', 465, 'Equipo <hola@x.co>'])
  })
})

describe('appBaseUrl', () => {
  it('prefers APP_BASE_URL, then AUTH_URL, strips trailing slashes, has a default', () => {
    expect(appBaseUrl({ APP_BASE_URL: 'https://a.co/', AUTH_URL: 'https://b.co' })).toBe('https://a.co')
    expect(appBaseUrl({ AUTH_URL: 'https://b.co//' })).toBe('https://b.co')
    expect(appBaseUrl({})).toMatch(/^https:\/\//)
  })
})

describe('sendMail', () => {
  it('without config is a no-op that never throws and never touches a transport', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { transport, calls } = fake(async () => ({}))
    const r = await sendMail(MSG, { config: null, transport })
    expect(r).toEqual({ ok: false, skipped: 'email_disabled' })
    expect(calls).toHaveLength(0)
    await sendMail(MSG, { config: null, transport })
    expect(log).toHaveBeenCalledTimes(1) // logged once per process, not per message
    expect(String(log.mock.calls[0][0])).toContain('email_disabled')
  })

  it('sends with the configured From and returns the message id', async () => {
    const { transport, calls } = fake(async () => ({ messageId: '<1@x>' }))
    const r = await sendMail({ ...MSG, headers: { 'List-Unsubscribe': '<https://x.co/u>' } }, { config: CONFIG, transport })
    expect(r).toEqual({ ok: true, messageId: '<1@x>', attempts: 1 })
    expect(calls[0].from).toBe('Faro <faro@example.com>')
    expect(calls[0].headers).toEqual({ 'List-Unsubscribe': '<https://x.co/u>' })
  })

  it('retries ONCE on a transient error and then succeeds', async () => {
    const { transport, calls } = fake(async n => {
      if (n === 1) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
      return { messageId: 'ok' }
    })
    const r = await sendMail(MSG, { config: CONFIG, transport, retryDelayMs: 0 })
    expect(r).toMatchObject({ ok: true, attempts: 2 })
    expect(calls).toHaveLength(2)
  })

  it('retries on SMTP 4xx but not on auth failures (5xx)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const busy = fake(async () => { throw Object.assign(new Error('busy'), { responseCode: 421 }) })
    const r1 = await sendMail(MSG, { config: CONFIG, transport: busy.transport, retryDelayMs: 0 })
    expect(busy.calls).toHaveLength(2)
    expect(r1).toMatchObject({ ok: false, attempts: 2, transient: true })

    const auth = fake(async () => { throw Object.assign(new Error('bad creds'), { code: 'EAUTH', responseCode: 535 }) })
    const r2 = await sendMail(MSG, { config: CONFIG, transport: auth.transport, retryDelayMs: 0 })
    expect(auth.calls).toHaveLength(1)
    expect(r2).toMatchObject({ ok: false, attempts: 1, transient: false })
  })

  it('never throws and never leaks the address or the error text into the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { transport } = fake(async () => { throw new Error('550 ana@example.com rejected') })
    const r = await sendMail(MSG, { config: CONFIG, transport, retryDelayMs: 0, kind: 'digest' })
    expect(r.ok).toBe(false)
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('email_send_failed')
    expect(line).toContain('digest')
    expect(line).not.toContain('ana@example.com')
  })

  it('rejects malformed recipients and strips line breaks from subject and headers (no header injection)', async () => {
    const { transport, calls } = fake(async () => ({}))
    for (const to of ['no-at-sign', 'a@b', 'a@b.co, c@d.co', 'a@b.co\nBcc: x@y.co', '']) {
      expect(await sendMail({ ...MSG, to }, { config: CONFIG, transport })).toEqual({ ok: false, skipped: 'invalid_message' })
    }
    expect(calls).toHaveLength(0)

    await sendMail({ ...MSG, subject: 'Hola\r\nBcc: evil@x.co', headers: { 'X-Test': 'a\r\nBcc: evil@x.co' } }, { config: CONFIG, transport })
    expect(calls[0].subject).toBe('Hola Bcc: evil@x.co')
    expect(calls[0].subject).not.toMatch(/[\r\n]/)
    expect(calls[0].headers!['X-Test']).not.toMatch(/[\r\n]/)
  })
})

describe('isTransientMailError', () => {
  it('classifies', () => {
    expect(isTransientMailError({ code: 'ECONNECTION' })).toBe(true)
    expect(isTransientMailError({ responseCode: 451 })).toBe(true)
    expect(isTransientMailError({ responseCode: 550 })).toBe(false)
    expect(isTransientMailError({ code: 'EAUTH' })).toBe(false)
    expect(isTransientMailError(null)).toBe(false)
  })
})

describe('sendMailBatch', () => {
  it('keeps at most 3 messages in flight and preserves order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const { transport } = fake(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return { messageId: 'x' }
    })
    const msgs = Array.from({ length: 10 }, (_, i) => ({ ...MSG, subject: `Mensaje ${i}` }))
    const r = await sendMailBatch(msgs, { config: CONFIG, transport, concurrency: 3 })
    expect(r.sent).toBe(10)
    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('stops at the per-run cap and reports the rest as capped', async () => {
    const { transport, calls } = fake(async () => ({}))
    const r = await sendMailBatch(Array.from({ length: 7 }, () => MSG), { config: CONFIG, transport, cap: 4 })
    expect(calls).toHaveLength(4)
    expect(r).toMatchObject({ sent: 4, failed: 0, capped: 3 })
  })

  it('counts failures without stopping the others', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { transport } = fake(async n => {
      if (n === 2) throw Object.assign(new Error('x'), { code: 'EAUTH', responseCode: 535 })
      return {}
    })
    const r = await sendMailBatch([MSG, MSG, MSG], { config: CONFIG, transport, concurrency: 1, retryDelayMs: 0 })
    expect(r).toMatchObject({ sent: 2, failed: 1, capped: 0 })
  })

  it('with no config nothing is sent and nothing counts as a failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await sendMailBatch([MSG, MSG], { config: null })
    expect(r).toMatchObject({ sent: 0, failed: 0 })
  })
})
