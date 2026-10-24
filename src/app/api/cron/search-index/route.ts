import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { cronOutcome, isBearerAuthorized } from '@/lib/cron-utils'
import { runSearchIndex } from '@/server/search-index'

/**
 * Search indexer. Cloud Scheduler calls this every ~5 minutes with the same bearer secret
 * as the other cron jobs. A static route, so it wins over `/api/cron/[task]`.
 *
 *   200  ok (or `not_ready`: the SQL 20261027_search.sql is not applied yet — nothing to do, no error)
 *   207  partial: something failed but work was done
 *   500  nothing worked, or ?strict=1 and anything failed
 *
 * Idempotent: every run resumes from stored cursors and re-running never duplicates rows.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handler(req: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron] CRON_SECRET not configured')
    return NextResponse.json({ error: 'Cron disabled' }, { status: 503 })
  }
  if (!isBearerAuthorized(req.headers.get('authorization'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const strict = new URL(req.url).searchParams.get('strict') === '1'
  try {
    const result = await runSearchIndex(createAdminSupabaseClient())
    const worked = Object.values(result.streams).reduce((n, s) => n + s.indexed + s.removed, 0) + result.embedded
    const outcome = cronOutcome({ sent: worked, skipped: result.embedSkipped, errors: result.errors.length }, strict)
    const summary = { task: 'search-index', ok: outcome.ok, partial: outcome.partial, ...result }
    if (!outcome.ok) {
      console.error(JSON.stringify({ severity: 'ERROR', message: '[cron] search-index finished with errors', ...summary }))
    }
    return NextResponse.json(summary, { status: outcome.status })
  } catch (err) {
    console.error(JSON.stringify({
      severity: 'ERROR',
      message: '[cron] search-index threw',
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }))
    return NextResponse.json({ task: 'search-index', ok: false, error: 'task_failed' }, { status: 500 })
  }
}

export { handler as GET, handler as POST }
