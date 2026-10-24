import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/server/routers'
import { createTRPCContext } from '@/lib/trpc/server'
import { auth } from '@/lib/auth'

/**
 * Call auth() here — at the top level of the Next.js Route Handler — where
 * Next.js's AsyncLocalStorage request context is guaranteed to be set up.
 *
 * If called inside fetchRequestHandler's createContext callback the context
 * may not be propagated correctly, causing auth() to return null even when
 * a valid session cookie is present.
 */
const handler = async (req: Request) => {
  const session = await auth()

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createTRPCContext(session, req.headers),
  })
}

export { handler as GET, handler as POST }
