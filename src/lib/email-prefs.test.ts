import { describe, expect, it } from 'vitest'
import { decideInstantEmail, emailRuleFor, resolveEmailPrefs, type EmailPrefs } from './email-prefs'

const prefs = (over: Partial<Pick<EmailPrefs, 'email_instant' | 'email_kinds'>> = {}) => ({ email_instant: true, email_kinds: {}, ...over })
const base = { pushLive: false, dueSoon: false, sentToday: 0 }

describe('resolveEmailPrefs', () => {
  it('defaults when the row is missing (columns not migrated yet) — daily 8:00, instant on', () => {
    expect(resolveEmailPrefs(null)).toEqual({ email_digest: 'daily', digest_hour: 8, email_instant: true, email_kinds: {}, last_digest_at: null })
    expect(resolveEmailPrefs(undefined).email_digest).toBe('daily')
  })
  it('keeps valid values and repairs junk', () => {
    const r = resolveEmailPrefs({ email_digest: 'weekly', digest_hour: 6, email_instant: false, email_kinds: { mention: true, dm: 'yes', task_assigned: false }, last_digest_at: '2026-10-22T11:00:00Z' })
    expect(r).toMatchObject({ email_digest: 'weekly', digest_hour: 6, email_instant: false, last_digest_at: '2026-10-22T11:00:00Z' })
    expect(r.email_kinds).toEqual({ mention: true, task_assigned: false })
    const junk = resolveEmailPrefs({ email_digest: 'hourly', digest_hour: 99, email_kinds: ['x'] })
    expect(junk).toMatchObject({ email_digest: 'daily', digest_hour: 8, email_kinds: {} })
  })
})

describe('emailRuleFor', () => {
  it('uses the defaults: reviews/approvals always, assignments only when due soon, the rest off', () => {
    const p = prefs()
    expect(emailRuleFor(p, 'task_review')).toBe('always')
    expect(emailRuleFor(p, 'doc_review')).toBe('always')
    expect(emailRuleFor(p, 'cost_run')).toBe('always')
    expect(emailRuleFor(p, 'task_assigned')).toBe('due48')
    expect(emailRuleFor(p, 'mention')).toBe('off')
    expect(emailRuleFor(p, 'dm')).toBe('off')
    expect(emailRuleFor(p, 'doc_decision')).toBe('off')
  })
  it('an explicit choice beats the default in both directions', () => {
    expect(emailRuleFor(prefs({ email_kinds: { task_assigned: true } }), 'task_assigned')).toBe('always')
    expect(emailRuleFor(prefs({ email_kinds: { doc_review: false } }), 'doc_review')).toBe('off')
    expect(emailRuleFor(prefs({ email_kinds: { mention: true } }), 'mention')).toBe('always')
  })
})

describe('decideInstantEmail', () => {
  it('approval requests are emailed even when the phone already buzzed', () => {
    for (const kind of ['task_review', 'doc_review', 'cost_run']) {
      expect(decideInstantEmail({ ...base, kind, prefs: prefs(), pushLive: true })).toEqual({ send: true })
    }
  })

  it('an assignment is emailed only when it is due within 48 h', () => {
    expect(decideInstantEmail({ ...base, kind: 'task_assigned', prefs: prefs(), dueSoon: false })).toEqual({ send: false, reason: 'not_due_soon' })
    expect(decideInstantEmail({ ...base, kind: 'task_assigned', prefs: prefs(), dueSoon: true })).toEqual({ send: true })
  })

  it('…and not when push already reached the person', () => {
    expect(decideInstantEmail({ ...base, kind: 'task_assigned', prefs: prefs(), dueSoon: true, pushLive: true })).toEqual({ send: false, reason: 'push_covers' })
  })

  it('an explicit opt-in always emails, even with push live and nothing due', () => {
    const p = prefs({ email_kinds: { task_assigned: true, mention: true } })
    expect(decideInstantEmail({ ...base, kind: 'task_assigned', prefs: p, pushLive: true, dueSoon: false })).toEqual({ send: true })
    expect(decideInstantEmail({ ...base, kind: 'mention', prefs: p, pushLive: true })).toEqual({ send: true })
  })

  it('kinds that are off by default are never emailed', () => {
    expect(decideInstantEmail({ ...base, kind: 'mention', prefs: prefs() })).toEqual({ send: false, reason: 'kind_off' })
    expect(decideInstantEmail({ ...base, kind: 'deadline', prefs: prefs() })).toEqual({ send: false, reason: 'kind_off' })
  })

  it('the master switch turns every instant email off', () => {
    expect(decideInstantEmail({ ...base, kind: 'doc_review', prefs: prefs({ email_instant: false }) })).toEqual({ send: false, reason: 'instant_off' })
  })

  it('caps at 10 per person per day, approvals included', () => {
    expect(decideInstantEmail({ ...base, kind: 'doc_review', prefs: prefs(), sentToday: 9 })).toEqual({ send: true })
    expect(decideInstantEmail({ ...base, kind: 'doc_review', prefs: prefs(), sentToday: 10 })).toEqual({ send: false, reason: 'cap' })
    expect(decideInstantEmail({ ...base, kind: 'doc_review', prefs: prefs(), sentToday: 3, cap: 3 })).toEqual({ send: false, reason: 'cap' })
  })
})
