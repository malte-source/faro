/**
 * WHO may see WHAT in the search — computed in ONE place and handed to the SQL
 * function `search_hybrid`, which applies it inside the query.
 *
 * This mirrors, rule for rule, how each router already scopes its own data (no
 * router is changed; if one of those rules changes, change it here too):
 *   tasks, project updates  → `ctx.projectIds`            (projects.ts / tasks.ts / project-updates.ts)
 *   documents               → grupo-wide + visibleEmpresas  (documents.ts `loadDoc` / `list`)
 *   decisions               → the whole grupo               (decisions.ts filters by org only)
 *   chat messages           → chat.ts: channels I belong to, plus public channels, both subject to
 *                             `publicAccessOk` — private channels and DMs are membership-only, and a
 *                             public channel gated by empresa/project ends reading when that access is lost.
 */

export interface ScopeChannel {
  id: string
  kind: 'channel' | 'dm'
  visibility: 'public' | 'private'
  workspace_id: string | null
  project_id: string | null
}

export interface ScopeInput {
  projectIds: string[]
  visibleWorkspaceIds: string[]
  isDirection: boolean
  workspaceScoped: boolean
  myWorkspaceIds: string[]
  /** Channels of the active grupo where the caller is a member. */
  memberChannels: ScopeChannel[]
  /** Every public channel of the active grupo (joined or not). */
  publicChannels: ScopeChannel[]
}

export interface SearchScope {
  projectIds: string[]
  channelIds: string[]
  workspaceIds: string[]
}

/** Same rule as `publicAccessOk` in routers/chat.ts. */
export function channelPublicAccessOk(
  input: Pick<ScopeInput, 'projectIds' | 'isDirection' | 'workspaceScoped' | 'myWorkspaceIds'>,
  ch: Pick<ScopeChannel, 'kind' | 'visibility' | 'workspace_id' | 'project_id'>,
): boolean {
  if (ch.kind !== 'channel' || ch.visibility !== 'public') return false
  if (ch.project_id && !input.projectIds.includes(ch.project_id)) return false
  if (ch.workspace_id && input.workspaceScoped && !input.isDirection && !input.myWorkspaceIds.includes(ch.workspace_id)) return false
  return true
}

export function buildSearchScope(input: ScopeInput): SearchScope {
  const channelIds = new Set<string>()
  // Channels I belong to — the same filter as `myChannels` in chat.ts.
  for (const ch of input.memberChannels) {
    if (ch.visibility === 'private' || ch.kind === 'dm' || channelPublicAccessOk(input, ch)) channelIds.add(ch.id)
  }
  // Public channels I could join also count: search is how you discover what was said there (chat.search does the same).
  for (const ch of input.publicChannels) {
    if (channelPublicAccessOk(input, ch)) channelIds.add(ch.id)
  }
  return {
    projectIds: Array.from(new Set(input.projectIds)),
    channelIds: Array.from(channelIds),
    workspaceIds: Array.from(new Set(input.visibleWorkspaceIds)),
  }
}
