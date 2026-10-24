import { describe, expect, it } from 'vitest'
import { estimateCostUsd, FALLBACK_PRICE, priceFor, upcomingPriceChanges } from './ai-pricing'

describe('priceFor — effective dates', () => {
  it('Flash 3.8 is $0.75 / $3.75 through 2026-12-31 and doubles on 2027-01-01', () => {
    expect(priceFor('gemini-3.8-flash', '2026-12-31')).toMatchObject({ inputPerM: 0.75, outputPerM: 3.75 })
    expect(priceFor('gemini-3.8-flash', '2027-01-01')).toMatchObject({ inputPerM: 1.5, outputPerM: 7.5 })
  })

  it('Argon is $2 / $10 through 2026-11-30 and $4 / $20 from 2026-12-01', () => {
    expect(priceFor('gemini-4-argon', '2026-11-30')).toMatchObject({ inputPerM: 2, outputPerM: 10 })
    expect(priceFor('gemini-4-argon', '2026-12-01')).toMatchObject({ inputPerM: 4, outputPerM: 20 })
  })

  it('a model without scheduled changes keeps one price forever', () => {
    expect(priceFor('gemini-3.5-flash-lite', '2026-01-01')).toMatchObject({ inputPerM: 0.3, outputPerM: 2.5 })
    expect(priceFor('gemini-3.5-flash-lite', '2030-01-01')).toMatchObject({ inputPerM: 0.3, outputPerM: 2.5 })
  })

  it('an unknown model is priced conservatively, never as free', () => {
    expect(priceFor('gemini-99-mystery', '2026-10-24')).toEqual(FALLBACK_PRICE)
    expect(estimateCostUsd({ model: 'gemini-99-mystery', inputTokens: 1_000_000 }, '2026-10-24')).toBe(4)
  })
})

describe('estimateCostUsd', () => {
  it('prices input and output separately, per million tokens', () => {
    // 2,000 in + 500 out on Flash 3.8 (2026-10-24): 2000*0.75/1e6 + 500*3.75/1e6 = 0.0015 + 0.001875
    expect(estimateCostUsd({ model: 'gemini-3.8-flash', inputTokens: 2000, outputTokens: 500 }, '2026-10-24')).toBe(0.003375)
  })

  it('the same call costs double after the 2027-01-01 cutover', () => {
    const call = { model: 'gemini-3.8-flash', inputTokens: 10_000, outputTokens: 2_000 }
    const before = estimateCostUsd(call, '2026-12-31')
    const after = estimateCostUsd(call, '2027-01-01')
    expect(after).toBeCloseTo(before * 2, 6)
  })

  it('uses the audio rate for the audio part of the input when the model has one', () => {
    // 1M input of which 400k audio on flash-lite 3.1: 600k*0.25 + 400k*0.50 = 0.15 + 0.20
    expect(estimateCostUsd({ model: 'gemini-3.1-flash-lite', inputTokens: 1_000_000, audioInputTokens: 400_000 }, '2026-10-24')).toBe(0.35)
  })

  it('audio tokens are priced as input when the model lists no audio rate', () => {
    const plain = estimateCostUsd({ model: 'gemini-3.8-flash', inputTokens: 1_000_000 }, '2026-10-24')
    const withAudio = estimateCostUsd({ model: 'gemini-3.8-flash', inputTokens: 1_000_000, audioInputTokens: 300_000 }, '2026-10-24')
    expect(withAudio).toBe(plain)
  })

  it('handles missing or negative token counts', () => {
    expect(estimateCostUsd({ model: 'gemini-3.8-flash' }, '2026-10-24')).toBe(0)
    expect(estimateCostUsd({ model: 'gemini-3.8-flash', inputTokens: -5, outputTokens: -5 }, '2026-10-24')).toBe(0)
  })
})

describe('upcomingPriceChanges', () => {
  it('lists the announced rises still ahead, soonest first', () => {
    const rises = upcomingPriceChanges('2026-10-24')
    expect(rises.map(r => `${r.model}@${r.from}`)).toEqual([
      'gemini-4-argon@2026-12-01',
      'gemini-3.8-flash@2027-01-01',
      'gemini-3.6-flash@2027-01-01',
    ])
  })

  it('is empty once every cutover has passed', () => {
    expect(upcomingPriceChanges('2027-02-01')).toEqual([])
  })
})
