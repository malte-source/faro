/**
 * AI price table — USD per 1,000,000 tokens, with EFFECTIVE DATES.
 *
 * Google announced price rises for the Flash and Argon families (Flash 3.8 / 3.6 on
 * 2027-01-01, Argon on 2026-12-01), so a price is a list of periods: the cost of a
 * call is computed with the period that applies on the day it was made. Source:
 * ai.google.dev/gemini-api/docs/pricing, read 2026-10-24. Update here — and only
 * here — when Google changes a price; `ai_usage.cost_usd` is stored at call time,
 * so history is never rewritten.
 *
 * The figures are ESTIMATES from token counts (usageMetadata); the invoice is the
 * source of truth. Thinking tokens are billed as output and callers fold them into
 * `outputTokens`.
 */

export interface PricePeriod {
  /** First day (YYYY-MM-DD, inclusive) this price applies. `null` = from the beginning. */
  from: string | null
  inputPerM: number
  outputPerM: number
  /** Audio input rate when it differs from text (defaults to inputPerM). */
  audioInputPerM?: number
}

const FLASH_38: PricePeriod[] = [
  { from: null, inputPerM: 0.75, outputPerM: 3.75 },
  { from: '2027-01-01', inputPerM: 1.5, outputPerM: 7.5 },
]

const PRICES: Record<string, PricePeriod[]> = {
  'gemini-3.8-flash': FLASH_38,
  'gemini-3.6-flash': FLASH_38,
  'gemini-3.5-flash-lite': [{ from: null, inputPerM: 0.3, outputPerM: 2.5 }],
  'gemini-3.1-flash-lite': [{ from: null, inputPerM: 0.25, outputPerM: 1.5, audioInputPerM: 0.5 }],
  'gemini-2.5-flash-lite': [{ from: null, inputPerM: 0.1, outputPerM: 0.4 }],
  'gemini-4-argon': [
    { from: null, inputPerM: 2, outputPerM: 10 },
    { from: '2026-12-01', inputPerM: 4, outputPerM: 20 },
  ],
  'gemini-embedding-2': [{ from: null, inputPerM: 0.2, outputPerM: 0 }],
}

/** Unknown model ids are priced like the most expensive known tier, so a budget never under-counts. */
export const FALLBACK_PRICE: PricePeriod = { from: null, inputPerM: 4, outputPerM: 20 }

/** The period that applies on `date` (YYYY-MM-DD) for `model`. */
export function priceFor(model: string, date: string): PricePeriod {
  const periods = PRICES[model]
  if (!periods) return FALLBACK_PRICE
  let current = periods[0]
  for (const p of periods) {
    if (p.from === null || p.from <= date) current = p
  }
  return current
}

export interface CostInput {
  model: string
  inputTokens?: number
  outputTokens?: number
  /** Part of `inputTokens` that was audio (priced with the audio rate when the model has one). */
  audioInputTokens?: number
}

/** Estimated USD for one call, rounded to 6 decimals (the `ai_usage.cost_usd` precision). */
export function estimateCostUsd(input: CostInput, date: string = new Date().toISOString().slice(0, 10)): number {
  const price = priceFor(input.model, date)
  const inTok = Math.max(0, input.inputTokens ?? 0)
  const outTok = Math.max(0, input.outputTokens ?? 0)
  const audio = Math.min(inTok, Math.max(0, input.audioInputTokens ?? 0))
  const audioRate = price.audioInputPerM ?? price.inputPerM
  const usd = ((inTok - audio) * price.inputPerM + audio * audioRate + outTok * price.outputPerM) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}

/** Known per-model price change dates still ahead of `today` — shown in the UI as a heads-up. */
export function upcomingPriceChanges(today: string): Array<{ model: string; from: string; inputPerM: number; outputPerM: number }> {
  const out: Array<{ model: string; from: string; inputPerM: number; outputPerM: number }> = []
  for (const [model, periods] of Object.entries(PRICES)) {
    for (const p of periods) {
      if (p.from && p.from > today) out.push({ model, from: p.from, inputPerM: p.inputPerM, outputPerM: p.outputPerM })
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}
