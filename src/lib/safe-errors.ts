/**
 * Decides which server errors may show their message to a person.
 *
 * Many routers `throw error` with a raw PostgrestError (a plain object) or let a runtime error
 * bubble up; tRPC wraps both as INTERNAL_SERVER_ERROR and the message would reach the browser:
 * table and column names, SQL hints, JS internals. Deliberate `throw new Error('Sin acceso…')`
 * messages are kept. The full detail always stays in the server log (see errorFormatter).
 */

export const SAFE_INTERNAL_MESSAGE = 'Algo salió mal. Intenta de nuevo.'

interface ErrorLike {
  code: string
  message: string
  cause?: unknown
}

export function leaksInternals(error: ErrorLike): boolean {
  if (error.code !== 'INTERNAL_SERVER_ERROR') return false

  const cause = error.cause as ({ code?: unknown; details?: unknown; hint?: unknown } & Partial<Error>) | undefined | null
  if (cause && typeof cause === 'object') {
    if (cause instanceof TypeError || cause instanceof ReferenceError || cause instanceof RangeError || cause instanceof SyntaxError) return true
    const c = typeof cause.code === 'string' ? cause.code : ''
    // PostgREST (PGRST…) / Postgres SQLSTATE (5 chars) / objects carrying details or hint.
    if (/^PGRST/.test(c) || /^[0-9A-Z]{5}$/.test(c) || 'details' in cause || 'hint' in cause) return true
  }
  return /\b(PGRST\d+|relation "|column "|violates .* constraint|duplicate key|syntax error at|permission denied for|JWT|fetch failed|ECONN|ETIMEDOUT)/i.test(error.message)
}
