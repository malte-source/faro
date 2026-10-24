import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { isBearerAuthorized } from '@/lib/cron-utils'

/**
 * Cheap-to-run health endpoint for uptime monitoring + Cloud Run health
 * probes. No auth required — returns 200 if the app is responsive and
 * Supabase is reachable, 503 if either is broken.
 *
 * What an anonymous caller sees: ONLY `{ status: 'ok' | 'error' }` (the HTTP code
 * carries the same signal for probes). Which env vars are missing, how long the
 * container has been up and the raw Supabase error text are diagnostics, returned
 * only to a caller presenting the cron bearer secret.
 *
 * What we check:
 *   - App container responds (implicit by reaching this handler)
 *   - Supabase: 1 lightweight SELECT (count head)
 *   - Required env vars are present
 *
 * What we DON'T check (intentionally):
 *   - Gemini reachability (rate-limited, would burn quota)
 *   - Drive/Calendar (requires user OAuth token, not service-level)
 *   - Service role secret validity (would leak partial info on failure)
 */

interface HealthStatus {
  ok: boolean
  uptime_ms: number
  checks: {
    app: 'ok'
    env: 'ok' | 'missing'
    supabase: 'ok' | 'error'
  }
  envMissing?: string[]
  supabaseError?: string
  timestamp: string
}

// Module-level start time so we report uptime per container
const _started = Date.now()

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AUTH_SECRET',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
]

async function check(): Promise<HealthStatus> {
  const envMissing = REQUIRED_ENV.filter(k => !process.env[k])
  let supabaseStatus: HealthStatus['checks']['supabase'] = 'ok'
  let supabaseError: string | undefined

  if (envMissing.length === 0) {
    try {
      const supabase = createAdminSupabaseClient()
      // Cheap query — HEAD with count only, doesn't return rows.
      const { error } = await supabase
        .from('organizations')
        .select('id', { count: 'exact', head: true })
        .limit(1)
      if (error) {
        supabaseStatus = 'error'
        supabaseError = error.message
      }
    } catch (err) {
      supabaseStatus = 'error'
      supabaseError = err instanceof Error ? err.message : String(err)
    }
  }

  const ok = envMissing.length === 0 && supabaseStatus === 'ok'
  return {
    ok,
    uptime_ms: Date.now() - _started,
    checks: {
      app: 'ok',
      env: envMissing.length === 0 ? 'ok' : 'missing',
      supabase: supabaseStatus,
    },
    ...(envMissing.length > 0 && { envMissing }),
    ...(supabaseError && { supabaseError }),
    timestamp: new Date().toISOString(),
  }
}

export async function GET(req: Request) {
  const status = await check()
  const httpStatus = status.ok ? 200 : 503
  if (!isBearerAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ status: status.ok ? 'ok' : 'error' }, { status: httpStatus })
  }
  return NextResponse.json({ status: status.ok ? 'ok' : 'error', ...status }, { status: httpStatus })
}
