/**
 * AI model configuration — the ONE place that names Gemini models.
 *
 * Google moves prices and retires preview IDs often (Flash 3.8 / 3.6 and Argon
 * get more expensive on 1 Dec 2026 and 1 Jan 2027), so call sites ask for a
 * TIER, never a model id, and an environment variable can swap any tier
 * without a deploy of new code.
 *
 *   lite  — cheap + fast: extraction, routing, classification
 *   flash — default: summaries, chat answers, document drafts
 *   pro   — hard cases only (long reasoning, tricky multimodal)
 *
 * Defaults are the IDs listed on ai.google.dev/gemini-api/docs/models on
 * 2026-10-24. Override per tier with GEMINI_MODEL_LITE / _FLASH / _PRO.
 */
export type ModelTier = 'lite' | 'flash' | 'pro'

export const DEFAULT_MODELS: Readonly<Record<ModelTier, string>> = {
  lite: 'gemini-3.5-flash-lite',
  flash: 'gemini-3.8-flash',
  pro: 'gemini-4-argon',
}

const ENV_KEYS: Record<ModelTier, string> = {
  lite: 'GEMINI_MODEL_LITE',
  flash: 'GEMINI_MODEL_FLASH',
  pro: 'GEMINI_MODEL_PRO',
}

/** A model id is a short slug; reject anything else so a bad env value can't reach the API path. */
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/i

/** Resolve a tier to a model id. Blank or malformed overrides fall back to the default. */
export function modelFor(tier: ModelTier = 'flash', env: Record<string, string | undefined> = process.env): string {
  const override = env[ENV_KEYS[tier]]?.trim()
  return override && MODEL_ID.test(override) ? override : DEFAULT_MODELS[tier]
}

/** Legacy constant: the default model of the `flash` tier. Prefer `modelFor('flash')`. */
export const FLASH_MODEL = DEFAULT_MODELS.flash
