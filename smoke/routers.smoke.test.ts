import { describe, expect, it } from 'vitest'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { createClient } from '@supabase/supabase-js'
import { appRouter } from '@/server/routers'
import { createTRPCContext } from '@/lib/trpc/server'

/**
 * Calls EVERY query procedure that needs no input (and a few with sample input) through the real tRPC
 * HTTP handler, as the owner, once per grupo/workspace. Queries are read-only. A procedure that needs
 * input answers BAD_REQUEST and is skipped; anything that answers INTERNAL_SERVER_ERROR is a failure.
 */
const OWNER_EMAIL = 'malte@thecrewagencia.com'

type ProcDef = { _def: { type: 'query' | 'mutation' | 'subscription' } }
const procedures = (appRouter as unknown as { _def: { procedures: Record<string, ProcDef> } })._def.procedures
const queryPaths = Object.entries(procedures).filter(([, p]) => p._def.type === 'query').map(([path]) => path).sort()

// Sample inputs for the queries that need one (read-only, harmless values).
const SAMPLE_INPUT: Record<string, unknown> = {
  'search.hybrid': { q: 'manual del grupo', limit: 5 },
  'search.global': 'tarea',
  'inbox.today': {},
  'aiUsage.summary': {},
}

async function owner() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: orgs } = await admin.from('org_memberships').select('org_id, organizations(name)').eq('user_id',
    (await admin.from('users').select('id').eq('email', OWNER_EMAIL).single()).data!.id)
  return (orgs ?? []).map(o => ({ id: o.org_id as string, name: (o.organizations as unknown as { name: string } | null)?.name ?? '?' }))
}

async function call(path: string, orgId: string) {
  const input = SAMPLE_INPUT[path]
  const url = `http://localhost/api/trpc/${path}${input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''}`
  const headers = new Headers({ cookie: `faro:active_org=${orgId}` })
  const session = { user: { email: OWNER_EMAIL, name: 'Smoke Test' }, expires: new Date(Date.now() + 3_600_000).toISOString() }
  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: new Request(url, { headers }),
    router: appRouter,
    createContext: () => createTRPCContext(session as never, headers),
  })
  const body = await res.json().catch(() => null) as { error?: { message?: string; data?: { code?: string } } } | null
  return { status: res.status, code: body?.error?.data?.code ?? null, message: body?.error?.message ?? null }
}

describe('router smoke (real database, read-only)', async () => {
  const orgs = await owner()

  it('finds the owner and at least one grupo', () => {
    expect(orgs.length).toBeGreaterThan(0)
  })

  for (const org of orgs) {
    it(`every query procedure answers without a server error — ${org.name}`, async () => {
      const failures: string[] = []
      let ok = 0, skipped = 0
      for (const path of queryPaths) {
        const r = await call(path, org.id)
        if (r.status === 200) ok++
        else if (r.code === 'BAD_REQUEST') skipped++ // needs input we don't have
        else if (r.code === 'FORBIDDEN' || r.code === 'NOT_FOUND' || r.code === 'UNAUTHORIZED') ok++ // a deliberate answer
        else failures.push(`${path} → ${r.status} ${r.code}: ${r.message}`)
      }
      console.log(`[${org.name}] ${queryPaths.length} queries · ${ok} ok · ${skipped} need input · ${failures.length} failing`)
      expect(failures, failures.join('\n')).toEqual([])
    })
  }
})
