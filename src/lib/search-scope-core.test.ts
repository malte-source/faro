import { describe, expect, it } from 'vitest'
import { buildSearchScope, channelPublicAccessOk, type ScopeChannel, type ScopeInput } from '@/lib/search-scope-core'

const ch = (id: string, over: Partial<ScopeChannel> = {}): ScopeChannel => ({
  id, kind: 'channel', visibility: 'public', workspace_id: null, project_id: null, ...over,
})

const base: ScopeInput = {
  projectIds: ['p1', 'p2'],
  visibleWorkspaceIds: ['w1'],
  isDirection: false,
  workspaceScoped: true,
  myWorkspaceIds: ['w1'],
  memberChannels: [],
  publicChannels: [],
}

describe('buildSearchScope — mirrors chat.ts / documents.ts / projects scoping', () => {
  it('passes through projects and empresas (deduplicated)', () => {
    const s = buildSearchScope({ ...base, projectIds: ['p1', 'p1', 'p2'], visibleWorkspaceIds: ['w1', 'w1'] })
    expect(s.projectIds).toEqual(['p1', 'p2'])
    expect(s.workspaceIds).toEqual(['w1'])
  })

  it('private channels and DMs are membership-only: included when a member, never when not', () => {
    const priv = ch('priv', { visibility: 'private' })
    const dm = ch('dm', { kind: 'dm', visibility: 'private' })
    expect(buildSearchScope({ ...base, memberChannels: [priv, dm] }).channelIds.sort()).toEqual(['dm', 'priv'])
    // a private channel can only ever come in through memberChannels
    expect(buildSearchScope({ ...base, publicChannels: [priv] }).channelIds).toEqual([])
  })

  it('a public channel gated by an empresa ends reading when the sombrero is lost, even for a member', () => {
    const gated = ch('gated', { workspace_id: 'w9' })
    const s = buildSearchScope({ ...base, memberChannels: [gated], publicChannels: [gated] })
    expect(s.channelIds).toEqual([])
  })

  it('Dirección is not gated by empresa; neither is a non-scoped grupo', () => {
    const gated = ch('gated', { workspace_id: 'w9' })
    expect(buildSearchScope({ ...base, isDirection: true, publicChannels: [gated] }).channelIds).toEqual(['gated'])
    expect(buildSearchScope({ ...base, workspaceScoped: false, publicChannels: [gated] }).channelIds).toEqual(['gated'])
  })

  it('a public channel gated by a project needs access to that project', () => {
    const projCh = ch('proj', { project_id: 'p9' })
    expect(buildSearchScope({ ...base, publicChannels: [projCh] }).channelIds).toEqual([])
    expect(buildSearchScope({ ...base, projectIds: ['p9'], publicChannels: [projCh] }).channelIds).toEqual(['proj'])
  })

  it('unjoined public channels count (search is how you discover them), once even if also joined', () => {
    const general = ch('general')
    const s = buildSearchScope({ ...base, memberChannels: [general], publicChannels: [general, ch('other')] })
    expect(s.channelIds.sort()).toEqual(['general', 'other'])
  })

  it('archived or foreign channels never arrive here; an empty person sees nothing', () => {
    const s = buildSearchScope({ ...base, projectIds: [], visibleWorkspaceIds: [] })
    expect(s).toEqual({ projectIds: [], channelIds: [], workspaceIds: [] })
  })
})

describe('channelPublicAccessOk', () => {
  const ctx = { projectIds: ['p1'], isDirection: false, workspaceScoped: true, myWorkspaceIds: ['w1'] }
  it('is false for private channels and DMs', () => {
    expect(channelPublicAccessOk(ctx, ch('x', { visibility: 'private' }))).toBe(false)
    expect(channelPublicAccessOk(ctx, ch('x', { kind: 'dm' }))).toBe(false)
  })
  it('is true for an ungated public channel', () => {
    expect(channelPublicAccessOk(ctx, ch('x'))).toBe(true)
  })
})
