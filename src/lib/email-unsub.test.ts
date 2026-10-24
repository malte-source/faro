import { describe, expect, it } from 'vitest'
import { parseScope, signUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from './email-unsub'

const USER = '3a26a0b3-0091-4c3e-a20c-bb779ffe97e1'
const OTHER = '11111111-2222-4333-8444-555555555555'
const SECRET = 'test-secret-with-enough-entropy'

describe('unsubscribe token', () => {
  it('verifies for the right person and secret', () => {
    const t = signUnsubscribeToken(USER, SECRET)
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/) // sha256 → 32 bytes → 43 base64url chars
    expect(verifyUnsubscribeToken(USER, t, SECRET)).toBe(true)
  })

  it('is bound to the user: a token for one person never unsubscribes another', () => {
    const t = signUnsubscribeToken(USER, SECRET)
    expect(verifyUnsubscribeToken(OTHER, t, SECRET)).toBe(false)
  })

  it('rejects a wrong secret, a tampered token, an empty token and a missing secret', () => {
    const t = signUnsubscribeToken(USER, SECRET)
    expect(verifyUnsubscribeToken(USER, t, 'other-secret')).toBe(false)
    expect(verifyUnsubscribeToken(USER, `${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`, SECRET)).toBe(false)
    expect(verifyUnsubscribeToken(USER, '', SECRET)).toBe(false)
    expect(verifyUnsubscribeToken(USER, t, undefined)).toBe(false)
    expect(verifyUnsubscribeToken(USER, t.slice(0, 10), SECRET)).toBe(false) // wrong length must not throw
  })

  it('refuses ids that are not UUIDs (nothing odd reaches the database)', () => {
    const t = signUnsubscribeToken("x' or '1'='1", SECRET)
    expect(verifyUnsubscribeToken("x' or '1'='1", t, SECRET)).toBe(false)
  })
})

describe('unsubscribeUrl', () => {
  it('builds a signed absolute link', () => {
    const url = unsubscribeUrl('https://faro.example', USER, SECRET)!
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://faro.example/api/email/unsubscribe')
    expect(u.searchParams.get('u')).toBe(USER)
    expect(verifyUnsubscribeToken(USER, u.searchParams.get('t')!, SECRET)).toBe(true)
  })
  it('is null without a secret', () => {
    expect(unsubscribeUrl('https://faro.example', USER, undefined)).toBeNull()
  })
})

describe('parseScope', () => {
  it('only "all" widens the scope', () => {
    expect(parseScope('all')).toBe('all')
    expect(parseScope('digest')).toBe('digest')
    expect(parseScope(undefined)).toBe('digest')
    expect(parseScope('whatever')).toBe('digest')
  })
})
