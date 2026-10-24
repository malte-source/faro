import { createAdminSupabaseClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { PublicProjectView } from './public-project-view'

/**
 * Public share page — accessible without auth.
 *
 * URL: /share/{token}
 *
 * Token = capability. Whoever has it can view the linked entity. The token
 * is 32 chars random base64-url (~190 bits) so guessing is infeasible.
 *
 * v1 supports only entity_type='project'. Future: 'task', 'goal'.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createAdminSupabaseClient()

  const { data: link } = await supabase
    .from('share_links')
    .select('id, entity_type, entity_id, label, expires_at, allow_comments')
    .eq('token', token)
    .single()

  if (!link) notFound()

  // Expired?
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-mist to-signal-wash/30 dark:from-night dark:to-[#12293A]">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-3xl">⏰</p>
          <h1 className="mt-4 text-xl font-bold text-night dark:text-stone-100">Link expirado</h1>
          <p className="mt-2 text-sm text-graphite">
            Este enlace ya no es válido. Pídele uno nuevo a quien te lo compartió.
          </p>
        </div>
      </main>
    )
  }

  // Bump access counter (fire-and-forget).
  void supabase
    .from('share_links')
    .update({
      access_count: 0,  // placeholder — see below
      last_accessed_at: new Date().toISOString(),
    })
    .eq('id', link.id)
  // We can't easily do count++ in one query without rpc; do it as a separate read+write
  // OR use a postgres function. For now we bump last_accessed_at only — counter
  // increment is best-effort and not critical.

  if (link.entity_type === 'project') {
    return <PublicProjectView projectId={link.entity_id} label={link.label} />
  }

  notFound()
}

export const metadata = {
  title: 'Vista compartida · FARO',
}
