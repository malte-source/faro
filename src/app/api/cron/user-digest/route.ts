import { NextResponse } from 'next/server'
import { cronOutcome, isBearerAuthorized } from '@/lib/cron-utils'
import { runUserDigest } from '@/server/email-digest'

/**
 * Hourly email digest. Cloud Scheduler hits this at the top of every hour:
 *
 *   gcloud scheduler jobs create http faro-user-digest --schedule="0 * * * *" --time-zone="UTC" \
 *     --uri="https://<app>/api/cron/user-digest" --http-method=GET \
 *     --headers="Authorization=Bearer <CRON_SECRET>"
 *
 * Each person gets their digest in THEIR timezone at THEIR chosen hour (see src/lib/email-schedule.ts);
 * running every hour is what makes that work for people in different zones. A static route, so it takes
 * precedence over /api/cron/[task]. Same auth and status contract as the other cron endpoints:
 *   200 everything fine (or nothing to do)   207 some people failed   500 nothing succeeded / threw
 *   ?strict=1 → any failure is a 500
 * With SMTP not configured, or the email columns not migrated yet, it answers 200 with `disabled`.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
  const started = Date.now()
  try {
    const result = await runUserDigest()
    const outcome = cronOutcome(result, strict)
    const summary = { task: 'user-digest', ok: outcome.ok, partial: outcome.partial, ...result, durationMs: Date.now() - started }
    return NextResponse.json(summary, { status: outcome.status })
  } catch (err) {
    console.error(JSON.stringify({
      severity: 'ERROR',
      message: '[cron] user-digest threw',
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }))
    return NextResponse.json({ task: 'user-digest', ok: false, error: 'task_failed', durationMs: Date.now() - started }, { status: 500 })
  }
}

export { handler as GET, handler as POST }
