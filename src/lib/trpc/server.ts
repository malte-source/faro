import { initTRPC, TRPCError } from '@trpc/server'
import { auth } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { ZodError } from 'zod'

/**
 * Server-side context cache.
 *
 * On a warm container:
 *   - Cache HIT  → 0 DB queries before any procedure runs
 *   - Cache MISS → 2 DB queries (user row + workspaces+projects combined)
 *
 * Before this change tasks.list + tasks.stats each added an extra
 * "SELECT id FROM projects WHERE workspace_id IN (...)" query on
 * every call, making the common case 3 round-trips instead of 1.
 *
 * TTL: 5 min — workspace/org/project membership changes are rare.
 * Call invalidateCtxCache(email) on project create/delete to bust early.
 */
type CtxCache = {
  me: { id: string; org_id: string }
  workspaceIds: string[]
  projectIds: string[]  // ← new: avoids per-request project ID lookup
  expiresAt: number
}
const _ctxCache = new Map<string, CtxCache>()

const CTX_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Call when a project is created or deleted so the next request re-fetches. */
export function invalidateCtxCache(email: string) {
  _ctxCache.delete(email)
}

/**
 * Context is created ONCE per HTTP request (shared across all batched procedures).
 * Pre-fetching user + workspace + project IDs here means each procedure pays
 * zero extra DB round-trips for this data on cache hit.
 */
export const createTRPCContext = async () => {
  const session = await auth()
  const supabase = createAdminSupabaseClient()

  let me: { id: string; org_id: string } | null = null
  let workspaceIds: string[] = []
  let projectIds: string[] = []

  if (session?.user?.email) {
    const email = session.user.email
    const now = Date.now()
    const cached = _ctxCache.get(email)

    if (cached && cached.expiresAt > now) {
      // Warm path — no DB queries needed
      me = cached.me
      workspaceIds = cached.workspaceIds
      projectIds = cached.projectIds
    } else {
      // Cold path — 2 DB queries total:

      // Query 1: user row (uses idx_users_email)
      const { data: user } = await supabase
        .from('users')
        .select('id, org_id')
        .eq('email', email)
        .single()

      if (user) {
        me = user

        // Query 2: workspaces + their project IDs — ONE round-trip via PostgREST join
        // (was previously 2 separate queries: workspaces then projects)
        const { data: workspaces } = await supabase
          .from('workspaces')
          .select('id, projects(id)')
          .eq('org_id', user.org_id)

        workspaceIds = workspaces?.map(w => w.id) ?? []
        projectIds = workspaces?.flatMap(w =>
          (w.projects as { id: string }[] | null ?? []).map(p => p.id)
        ) ?? []

        _ctxCache.set(email, {
          me: user,
          workspaceIds,
          projectIds,
          expiresAt: now + CTX_TTL_MS,
        })
      }
    }
  }

  return { session, supabase, me, workspaceIds, projectIds }
}

const t = initTRPC.context<typeof createTRPCContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

export const createTRPCRouter = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.email || !ctx.me) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session as NonNullable<typeof ctx.session> & {
        user: NonNullable<typeof ctx.session.user>
      },
      me: ctx.me as { id: string; org_id: string },
      workspaceIds: ctx.workspaceIds,
      projectIds: ctx.projectIds,
    },
  })
})
