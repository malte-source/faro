import { describe, expect, it } from 'vitest'
import { leaksInternals, SAFE_INTERNAL_MESSAGE } from './safe-errors'

const internal = (message: string, cause?: unknown) => ({ code: 'INTERNAL_SERVER_ERROR', message, cause })

describe('leaksInternals', () => {
  it('masks raw PostgREST errors (plain object with details/hint)', () => {
    const cause = { code: '42703', message: 'column tasks.workspace_id does not exist', details: null, hint: null }
    expect(leaksInternals(internal(cause.message, cause))).toBe(true)
  })

  it('masks Postgres SQLSTATE and PGRST codes even without details', () => {
    expect(leaksInternals(internal('x', { code: '23505' }))).toBe(true)
    expect(leaksInternals(internal('x', { code: 'PGRST202' }))).toBe(true)
  })

  it('masks runtime errors (TypeError and friends)', () => {
    expect(leaksInternals(internal("Cannot read properties of undefined (reading 'id')", new TypeError('boom')))).toBe(true)
    expect(leaksInternals(internal('x', new ReferenceError('y is not defined')))).toBe(true)
  })

  it('masks database-looking messages even when the cause is unknown', () => {
    expect(leaksInternals(internal('relation "chat_messages" does not exist'))).toBe(true)
    expect(leaksInternals(internal('duplicate key value violates unique constraint "idx_x"'))).toBe(true)
    expect(leaksInternals(internal('fetch failed'))).toBe(true)
    expect(leaksInternals(internal('JWT expired'))).toBe(true)
  })

  it('keeps deliberate plain-Error messages written for people', () => {
    expect(leaksInternals(internal('Sin acceso al proyecto.', new Error('Sin acceso al proyecto.')))).toBe(false)
    expect(leaksInternals(internal('Project not found', new Error('Project not found')))).toBe(false)
  })

  it('never touches user-facing tRPC codes', () => {
    for (const code of ['FORBIDDEN', 'BAD_REQUEST', 'NOT_FOUND', 'CONFLICT', 'TOO_MANY_REQUESTS', 'UNAUTHORIZED']) {
      expect(leaksInternals({ code, message: 'relation "x" does not exist', cause: { code: '42P01', details: null } })).toBe(false)
    }
  })

  it('exposes a safe Spanish fallback message', () => {
    expect(SAFE_INTERNAL_MESSAGE).toBe('Algo salió mal. Intenta de nuevo.')
  })
})
