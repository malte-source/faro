import { describe, expect, it } from 'vitest'
import { cronOutcome, decideRuleClaim, isBearerAuthorized, safeEqual } from './cron-utils'

describe('safeEqual', () => {
  it('matches equal strings and rejects different ones, whatever their length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
  })
})

describe('isBearerAuthorized', () => {
  it('accepts only the exact bearer token', () => {
    expect(isBearerAuthorized('Bearer s3cret', 's3cret')).toBe(true)
    expect(isBearerAuthorized('Bearer s3cret ', 's3cret')).toBe(false)
    expect(isBearerAuthorized('bearer s3cret', 's3cret')).toBe(false)
    expect(isBearerAuthorized('s3cret', 's3cret')).toBe(false)
  })
  it('never authorises when the secret or the header is missing', () => {
    expect(isBearerAuthorized(null, 's3cret')).toBe(false)
    expect(isBearerAuthorized('Bearer ', undefined)).toBe(false)
    expect(isBearerAuthorized('Bearer undefined', undefined)).toBe(false)
    expect(isBearerAuthorized('Bearer ', '')).toBe(false)
  })
})

describe('cronOutcome', () => {
  it('is 200 when nothing failed', () => {
    expect(cronOutcome({ sent: 3, skipped: 1, errors: 0 })).toEqual({ status: 200, ok: true, partial: false })
    expect(cronOutcome({ sent: 0, skipped: 5, errors: 0 }).status).toBe(200)
  })
  it('is 207 when some orgs failed and some succeeded', () => {
    expect(cronOutcome({ sent: 2, skipped: 0, errors: 1 })).toEqual({ status: 207, ok: false, partial: true })
  })
  it('is 500 when everything that ran failed', () => {
    expect(cronOutcome({ sent: 0, skipped: 2, errors: 1 })).toEqual({ status: 500, ok: false, partial: false })
  })
  it('strict mode turns any error into a 500', () => {
    expect(cronOutcome({ sent: 9, skipped: 0, errors: 1 }, true).status).toBe(500)
  })
})

describe('decideRuleClaim', () => {
  const today = '2026-10-24'
  it('claims a due rule that has not run today', () => {
    expect(decideRuleClaim({ next_run_at: today, last_run_at: '2026-10-23' }, today)).toBe('claim')
    expect(decideRuleClaim({ next_run_at: '2026-10-20', last_run_at: null }, today)).toBe('claim') // overdue catch-up
  })
  it('does not claim a rule scheduled for later', () => {
    expect(decideRuleClaim({ next_run_at: '2026-10-25', last_run_at: '2026-10-24' }, today)).toBe('not_due')
  })
  it('never claims twice on the same local day (duplicate guard)', () => {
    expect(decideRuleClaim({ next_run_at: today, last_run_at: today }, today)).toBe('already_ran')
  })
  it('decides by the org-local date: the same rule can be due in one timezone and not in another', () => {
    const rule = { next_run_at: '2026-10-25', last_run_at: null }
    expect(decideRuleClaim(rule, '2026-10-24')).toBe('not_due') // Buenos Aires, still the 24th
    expect(decideRuleClaim(rule, '2026-10-25')).toBe('claim') // already the 25th in Asia/Tokyo
  })
})
