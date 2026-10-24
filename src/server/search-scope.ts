import { isDirection, visibleEmpresas, type EmpresaCtx, type EmpresaRow } from '@/server/multiempresa'
import { buildSearchScope, type ScopeChannel, type SearchScope } from '@/lib/search-scope-core'

export { buildSearchScope, channelPublicAccessOk } from '@/lib/search-scope-core'
export type { ScopeChannel, ScopeInput, SearchScope } from '@/lib/search-scope-core'

/**
 * Loader half of the search scope. The rules themselves live in src/lib/search-scope-core.ts
 * (pure, unit-tested); this file only fetches what they need for the caller.
 */

type ScopeCtx = EmpresaCtx & { projectIds: string[] }

const CHANNEL_COLS = 'id, kind, visibility, workspace_id, project_id'

/**
 * Load what `buildSearchScope` needs for the caller, and hand back the visible empresas too
 * (the router needs their names). Chat tables missing → no chat results, never an error.
 */
export async function loadSearchScope(ctx: ScopeCtx): Promise<{ scope: SearchScope; empresas: EmpresaRow[] }> {
  const org = ctx.activeOrg
  if (!org) return { scope: { projectIds: [], channelIds: [], workspaceIds: [] }, empresas: [] }

  const [empresas, memberRes, publicRes] = await Promise.all([
    visibleEmpresas(ctx),
    ctx.supabase
      .from('chat_members')
      .select(`channel:chat_channels!inner(${CHANNEL_COLS})`)
      .eq('user_id', ctx.me.id)
      .eq('channel.org_id', org.id)
      .is('channel.archived_at', null),
    ctx.supabase
      .from('chat_channels')
      .select(CHANNEL_COLS)
      .eq('org_id', org.id)
      .eq('kind', 'channel')
      .eq('visibility', 'public')
      .is('archived_at', null),
  ])

  const memberChannels = memberRes.error
    ? []
    : ((memberRes.data ?? []) as unknown as Array<{ channel: ScopeChannel | null }>)
        .map(r => r.channel)
        .filter((c): c is ScopeChannel => !!c)
  const publicChannels = publicRes.error ? [] : ((publicRes.data ?? []) as unknown as ScopeChannel[])

  const scope = buildSearchScope({
    projectIds: ctx.projectIds,
    visibleWorkspaceIds: empresas.map(e => e.id),
    isDirection: isDirection(ctx),
    workspaceScoped: !!org.workspace_scoped,
    myWorkspaceIds: ctx.myWorkspaceIds,
    memberChannels,
    publicChannels,
  })
  return { scope, empresas }
}
