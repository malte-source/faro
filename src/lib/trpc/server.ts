import { initTRPC, TRPCError } from '@trpc/server'
import { auth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase'
import { ZodError } from 'zod'

export const createTRPCContext = async () => {
  const session = await auth()
  const supabase = await createServerSupabaseClient()
  return { session, supabase }
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
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { ...ctx, session: ctx.session } })
})
