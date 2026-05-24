import { initTRPC, TRPCError } from '@trpc/server'
import { auth } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { ZodError } from 'zod'

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
    const { data: user } = await supabase
      .from('users')
      .select('id, org_id')
      .eq('email', session.user.email)
      .single()

    if (user) {
      me = user
      const { data: wss } = await supabase
        .from('workspaces')
        .select('id')
        .eq('org_id', user.org_id)
      workspaceIds = wss?.map(w => w.id) ?? []
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
