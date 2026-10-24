import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Strip UTF-8 BOM (U+FEFF) and surrounding whitespace from env vars.
 *
 * GCP Secret Manager preserves whatever bytes were stored — if a secret
 * was created from a Windows UTF-8-with-BOM file (or pasted with a
 * trailing newline), those bytes end up in process.env.  When the
 * Supabase client puts them in fetch headers, the Node fetch implementation
 * rejects them with:
 *   "Cannot convert argument to a ByteString because the character at
 *    index 0 has a value of 65279"
 * causing every Supabase request to fail before it's sent.
 *
 * We strip: BOM (U+FEFF), C0 control chars (U+0000–U+001F), DEL (U+007F),
 * and C1 control chars (U+0080–U+009F).  All are illegal in HTTP headers.
 *
 * Built via RegExp constructor with explicit \uXXXX escapes so this
 * source file contains zero literal control bytes.
 *
 * IMPORTANT: env reads are LAZY (inside functions) so that `next build`
 * succeeds even when secrets aren't mounted.  The original bug here was
 * reading at module top-level, which throws during the build phase.
 */
const INVALID_HEADER_CHARS = new RegExp(
  '[\\uFEFF\\u0000-\\u001F\\u007F\\u0080-\\u009F]',
  'g',
)

function cleanEnv(name: string): string {
  const raw = process.env[name]
  if (!raw) throw new Error(`Missing env var: ${name}`)
  return raw.replace(INVALID_HEADER_CHARS, '').trim()
}

// Service role client — bypasses RLS for server-side tRPC procedures.
// Never expose this key to the client.
//
// Singleton pattern: reuse the same client across requests so the
// underlying HTTP keep-alive pool is preserved.  Creating a new client
// per request was the main source of TCP+TLS setup latency on Cloud Run.
let _adminClient: ReturnType<typeof createSupabaseClient<Database>> | null = null

export function createAdminSupabaseClient() {
  if (!_adminClient) {
    _adminClient = createSupabaseClient<Database>(
      cleanEnv('NEXT_PUBLIC_SUPABASE_URL'),
      cleanEnv('SUPABASE_SERVICE_ROLE_KEY'),
    )
  }
  return _adminClient
}
