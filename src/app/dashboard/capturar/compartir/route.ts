import { TRPCError } from '@trpc/server'
import { auth } from '@/lib/auth'
import { createTRPCContext } from '@/lib/trpc/server'
import { appRouter } from '@/server/routers'
import { CAPTURE_BUCKET, CAPTURE_MAX_BYTES, CAPTURE_TEXT_MAX_CHARS, baseMime } from '@/lib/capture-schema'
import { mimeFromFilename, uploadKindOfMime } from '@/lib/capture-media'

/**
 * Web Share Target (Android Chrome / installed PWA): "Compartir → Faro" from any
 * app lands here (manifest `share_target`, POST multipart). iPhone has no share
 * target, so this is Android-only; iOS gets a hint on the capture screen.
 *
 * It runs through the SAME tRPC procedures as the app (plan/AI gates, empresa
 * visibility, audit), with the signed-in person's context, then redirects to the
 * capture screen:
 *   file  → capture is created + uploaded here, the screen sends it to Faro's reading (?auto=1)
 *   text  → short text rides in the URL and is sent by the screen through the offline
 *           outbox; long text is analysed here
 * The answer is always a 303 with a RELATIVE Location (behind Cloud Run the request
 * URL's host is internal, so never build absolute URLs from it).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAPTURE_PAGE = '/dashboard/capturar'
/** Above this a shared text isn't put in a URL. */
const MAX_TEXT_IN_URL = 1500

const redirect = (path: string) => new Response(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } })
const back = (error: string) => redirect(`${CAPTURE_PAGE}?error=${error}`)

/** title + text + url, de-duplicated (Android often repeats the URL in both `text` and `url`). */
function joinSharedText(parts: Array<FormDataEntryValue | string | null | undefined>): string {
  const clean = parts.map(p => (typeof p === 'string' ? p.trim() : '')).filter(Boolean)
  return Array.from(new Set(clean)).join('\n')
}

async function handle(req: Request, input: { text: string; file: File | null }): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return redirect('/login')

  const ctx = await createTRPCContext(session, req.headers)
  if (!ctx.me) return redirect('/login')
  const caller = appRouter.createCaller(ctx)

  try {
    if (input.file) {
      const file = input.file
      if (file.size > CAPTURE_MAX_BYTES) return back('toobig')
      const mime = baseMime(file.type) || mimeFromFilename(file.name) || ''
      const kind = uploadKindOfMime(mime)
      if (!kind) return back('unsupported')

      const up = await caller.capture.createUpload({ kind, mimeType: mime, clientId: crypto.randomUUID() })
      const { error } = await ctx.supabase.storage
        .from(CAPTURE_BUCKET)
        .upload(up.path, new Uint8Array(await file.arrayBuffer()), { contentType: mime, upsert: true })
      if (error) return back('failed')
      return redirect(`${CAPTURE_PAGE}?c=${up.captureId}&auto=1`)
    }

    const text = input.text.slice(0, CAPTURE_TEXT_MAX_CHARS)
    if (text.length < 3) return back('empty')
    if (text.length <= MAX_TEXT_IN_URL) return redirect(`${CAPTURE_PAGE}?t=${encodeURIComponent(text)}&auto=1`)

    const res = await caller.capture.submitText({ text, clientId: crypto.randomUUID() })
    return redirect(`${CAPTURE_PAGE}?c=${res.captureId}`)
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'FORBIDDEN') return back('plan')
    console.error(JSON.stringify({ severity: 'ERROR', message: 'share target failed', code: err instanceof TRPCError ? err.code : 'UNKNOWN' }))
    return back('failed')
  }
}

export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return back('empty')
  }
  const files = form.getAll('media').filter((v): v is File => typeof v !== 'string' && v.size > 0)
  return handle(req, {
    text: joinSharedText([form.get('title'), form.get('text'), form.get('url')]),
    file: files[0] ?? null,
  })
}

/** Older installs (and links) used GET with query params: same text path. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const text = joinSharedText([q.get('title'), q.get('text'), q.get('url')])
  if (!text) return redirect(CAPTURE_PAGE)
  return handle(req, { text, file: null })
}
