/**
 * In-memory token-bucket rate limiter.
 *
 * Tradeoff: per Cloud Run instance, so with --min-instances=1 + low traffic
 * it works correctly. If we scale to multiple instances later, a user's
 * effective limit gets multiplied by the instance count. Acceptable for
 * MVP — when we go SaaS we replace this with Upstash Redis or similar
 * shared store (no contract change, just swap this module's implementation).
 *
 * Why a token bucket and not a fixed-window? Token buckets allow burst
 * (e.g. open the dashboard which fires 3 AI calls at once) while still
 * enforcing a long-term rate. Fixed-window would reject the burst even if
 * the user has been idle for hours.
 */

import { TRPCError } from '@trpc/server'

interface Bucket {
  tokens: number
  lastRefill: number
}

const _buckets = new Map<string, Bucket>()

// Reasonable defaults for Gemini-backed procedures. Tunable per-call.
export const AI_LIMIT = {
  tokensPerMinute: 0.5, // 30 per hour
  maxBurst: 10,         // can fire 10 quick AI calls in a row
}

/**
 * Try to consume 1 token. Returns true if allowed, false if rate-limited.
 *
 * @param key  Bucket identifier — typically `${userId}:${procedure}`. Use
 *             distinct keys per operation type so quick-add doesn't eat
 *             the budget of the project chat.
 */
export function tryConsume(
  key: string,
  opts: { tokensPerMinute: number; maxBurst: number } = AI_LIMIT,
): boolean {
  const now = Date.now()
  let bucket = _buckets.get(key)
  if (!bucket) {
    bucket = { tokens: opts.maxBurst, lastRefill: now }
    _buckets.set(key, bucket)
  }
  // Refill since last check
  const elapsedMin = (now - bucket.lastRefill) / 60_000
  bucket.tokens = Math.min(opts.maxBurst, bucket.tokens + elapsedMin * opts.tokensPerMinute)
  bucket.lastRefill = now

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return true
  }
  return false
}

/**
 * Throw TOO_MANY_REQUESTS if the user has exhausted their bucket.
 * Wraps tryConsume with a tRPC-friendly error so the client gets a
 * clean 429 + a helpful message instead of a generic 500.
 */
export function enforceRateLimit(
  key: string,
  opts: { tokensPerMinute: number; maxBurst: number } = AI_LIMIT,
): void {
  if (!tryConsume(key, opts)) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Demasiados pedidos a la IA. Espera un minuto antes de volver a intentar.',
    })
  }
}

/**
 * Periodic cleanup so the buckets Map doesn't leak memory for users that
 * stop using the app. We discard buckets older than 1 h (well past full
 * refill at default settings, so dropping them is safe).
 *
 * Runs lazily on every 200th call to keep overhead negligible.
 */
let _callCount = 0
export function gcBuckets(): void {
  _callCount++
  if (_callCount % 200 !== 0) return
  const cutoff = Date.now() - 60 * 60_000
  for (const [k, b] of _buckets) {
    if (b.lastRefill < cutoff) _buckets.delete(k)
  }
}
