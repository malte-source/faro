import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Who an AI call is being made for. Set once per tRPC procedure (protectedProcedure)
 * or per cron organisation, and read by the Gemini wrapper — so no call site has to
 * thread `orgId` / `userId` through just to get the call metered and budgeted.
 */
export interface AiContext {
  orgId: string | null
  userId: string | null
  /** tRPC path (`tasks.parseAndCreate`) or a cron label (`cron.weekly-digest`). Used as the default feature name. */
  path: string | null
}

const storage = new AsyncLocalStorage<AiContext>()

export function runWithAiContext<T>(ctx: AiContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getAiContext(): AiContext | undefined {
  return storage.getStore()
}
