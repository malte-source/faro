import { initTRPC, TRPCError } from '@trpc/server'
import { auth } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { ZodError } from 'zod'

/**
 * Short-lived server-side cache for user + workspace IDs.
 * Eliminates 2 DB round-trips on every tRPC batch when the container is warm.
 * TTL: 60 s — stale data doesn't matter for org/workspace memberships.
 */
type CtxCache = {
  me: { id: string; org_id: string }
  workspaceIds: string[]
  expiresAt: number
}
const _ctxCache = new Map<string, CtxCache>()

/**
 * Context is created ONCE per HTTP request (per batch).
 * We pre-fetch the current user + workspace IDs here so routers
 * don't each do their own redundant DB round-trip.
 */
export const createTRPCContext = async () => {
  const session = await auth()
  const supabase = createAdminSupabaseClient()

  let me: { id: string; org_id: string } | null = null
  let workspaceIds: string[] = []

  if (session?.user?.email) {
    const email = session.user.email
    const now = Date.now()
    const cached = _ctxCache.get(email)

    if (cached && cached.expiresAt > now) {
      me = cached.me
      workspaceIds = cached.workspaceIds
    } else {
      const { data: user } = await supabase
        .from('users')
        .select('id, org_id')
        .eq('email', email)
        .single()

      if (user) {
        me = user
        const { data: wss } = await supabase
          .from('workspaces')
          .select('id')
          .eq('org_id', user.org_id)
        workspaceIds = wss?.map(w => w.id) ?? []
        _ctxCache.set(email, { me: user, workspaceIds, expiresAt: now + 60_000 })
      }
    }
  }

  return { session, supabase, me, workspaceIds }
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
    },
  })
})
