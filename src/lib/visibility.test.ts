import { describe, expect, it } from 'vitest'
import {
  computeVisibility,
  needsSharedLookup,
  resolveMyWorkspaceIds,
  type RawProject,
  type VisibilityInput,
} from './visibility'

// Fixture: two empresas (W1, W2) and a mix of visibilities.
const ME = 'u-me'
const OTHER = 'u-other'
const projects: RawProject[] = [
  { id: 'pub-w1', visibility: 'workspace', created_by: OTHER, workspace_id: 'W1' },
  { id: 'pub-w2', visibility: 'workspace', created_by: OTHER, workspace_id: 'W2' },
  { id: 'default-w1', visibility: null, created_by: OTHER, workspace_id: 'W1' }, // null = workspace
  { id: 'priv-w1', visibility: 'private', created_by: OTHER, workspace_id: 'W1' },
  { id: 'priv-w2', visibility: 'private', created_by: OTHER, workspace_id: 'W2' },
  { id: 'mine-personal', visibility: 'personal', created_by: ME, workspace_id: 'W1' },
  { id: 'their-personal', visibility: 'personal', created_by: OTHER, workspace_id: 'W1' },
]

const base: VisibilityInput = {
  userId: ME,
  role: 'member',
  rawProjects: projects,
  memberProjectIds: [],
  myWorkspaceIds: [],
  workspaceScoped: false,
}
const run = (over: Partial<VisibilityInput>) => computeVisibility({ ...base, ...over })
const sorted = (ids: string[]) => [...ids].sort()

describe('computeVisibility · classic orgs', () => {
  it('admin sees every workspace-visible project plus own personal, not others\' private/personal', () => {
    const r = run({ role: 'admin' })
    expect(sorted(r.projectIds)).toEqual(['default-w1', 'mine-personal', 'pub-w1', 'pub-w2'])
    expect(r.projectIds).toEqual(r.allOrgProjectIds)
  })

  it('owner behaves like admin', () => {
    expect(sorted(run({ role: 'owner' }).projectIds)).toEqual(['default-w1', 'mine-personal', 'pub-w1', 'pub-w2'])
  })

  it('private needs explicit membership even for admins', () => {
    const without = run({ role: 'admin' })
    expect(without.allOrgProjectIds).not.toContain('priv-w1')
    const withMembership = run({ role: 'admin', memberProjectIds: ['priv-w1'] })
    expect(withMembership.allOrgProjectIds).toContain('priv-w1')
    expect(withMembership.allOrgProjectIds).not.toContain('priv-w2')
  })

  it('personal is only for the creator, whatever the role', () => {
    for (const role of ['owner', 'admin', 'member']) {
      const r = run({ role, memberProjectIds: ['their-personal'] })
      expect(r.allOrgProjectIds).not.toContain('their-personal')
    }
    expect(run({ role: 'member', memberProjectIds: ['mine-personal'] }).projectIds).toContain('mine-personal')
  })

  it('a member sees only the projects they belong to', () => {
    const r = run({ role: 'member', memberProjectIds: ['pub-w1', 'priv-w1'] })
    expect(sorted(r.projectIds)).toEqual(['priv-w1', 'pub-w1'])
    expect(sorted(r.myMembershipIds)).toEqual(['priv-w1', 'pub-w1'])
  })

  it('memberships to projects hidden from the user are ignored (no leak through project_members)', () => {
    // Member of someone else's personal project (stale row): still not visible.
    const r = run({ role: 'member', memberProjectIds: ['their-personal', 'pub-w2'] })
    expect(r.projectIds).toEqual(['pub-w2'])
  })

  it('a member with no memberships sees nothing, empty inputs are safe', () => {
    expect(run({ role: 'member' }).projectIds).toEqual([])
    const empty = run({ role: 'admin', rawProjects: [] })
    expect(empty).toEqual({ allOrgProjectIds: [], myMembershipIds: [], projectIds: [] })
  })

  it('unknown roles (viewer, guest, manager) get the member view, not the admin view', () => {
    for (const role of ['viewer', 'guest', 'manager']) {
      expect(run({ role, memberProjectIds: ['pub-w1'] }).projectIds).toEqual(['pub-w1'])
    }
  })

  it('classic orgs ignore sombreros and shared lookups', () => {
    const r = run({ role: 'member', myWorkspaceIds: ['W1'], sharedProjectIds: ['pub-w2'], memberProjectIds: [] })
    expect(r.projectIds).toEqual([])
  })

  it('myMembershipIds is always a subset of allOrgProjectIds', () => {
    const r = run({ role: 'admin', memberProjectIds: ['priv-w1', 'their-personal', 'pub-w2'] })
    for (const id of r.myMembershipIds) expect(r.allOrgProjectIds).toContain(id)
    expect(r.myMembershipIds).not.toContain('their-personal')
  })
})

describe('computeVisibility · workspace-scoped orgs (grupo mode)', () => {
  const scoped = (over: Partial<VisibilityInput>) => run({ workspaceScoped: true, ...over })

  it('a member sees the visible projects of their empresas', () => {
    const r = scoped({ myWorkspaceIds: ['W1'] })
    expect(sorted(r.projectIds)).toEqual(['default-w1', 'mine-personal', 'pub-w1'])
  })

  it('still hides private projects of the empresa unless the member belongs to them', () => {
    expect(scoped({ myWorkspaceIds: ['W1'] }).projectIds).not.toContain('priv-w1')
    expect(scoped({ myWorkspaceIds: ['W1'], memberProjectIds: ['priv-w1'] }).projectIds).toContain('priv-w1')
  })

  it('never exposes someone else\'s personal project, even in the member\'s empresa', () => {
    expect(scoped({ myWorkspaceIds: ['W1'] }).projectIds).not.toContain('their-personal')
  })

  it('adds projects shared with the member\'s empresas', () => {
    const r = scoped({ myWorkspaceIds: ['W1'], sharedProjectIds: ['pub-w2'] })
    expect(r.projectIds).toContain('pub-w2')
    expect(r.projectIds).not.toContain('priv-w2')
  })

  it('a shared project that is private to the user is still hidden', () => {
    const r = scoped({ myWorkspaceIds: ['W1'], sharedProjectIds: ['priv-w2'] })
    expect(r.projectIds).not.toContain('priv-w2')
  })

  it('merges explicit memberships without duplicates', () => {
    const r = scoped({ myWorkspaceIds: ['W1'], memberProjectIds: ['pub-w1', 'pub-w2'] })
    expect(sorted(r.projectIds)).toEqual(['default-w1', 'mine-personal', 'pub-w1', 'pub-w2'])
  })

  it('without any sombrero it falls back to explicit memberships only', () => {
    const r = scoped({ myWorkspaceIds: [], memberProjectIds: ['pub-w2'], sharedProjectIds: ['pub-w1'] })
    expect(r.projectIds).toEqual(['pub-w2'])
  })

  it('admins keep the org-wide view (sombreros do not narrow it)', () => {
    const r = scoped({ role: 'admin', myWorkspaceIds: ['W1'] })
    expect(sorted(r.projectIds)).toEqual(['default-w1', 'mine-personal', 'pub-w1', 'pub-w2'])
  })
})

describe('helpers', () => {
  it('resolveMyWorkspaceIds drops sombreros from other grupos', () => {
    expect(resolveMyWorkspaceIds(['W1', 'W2'], ['W2', 'X9'])).toEqual(['W2'])
    expect(resolveMyWorkspaceIds([], ['W1'])).toEqual([])
  })

  it('needsSharedLookup only fires for scoped orgs with a sombrero', () => {
    expect(needsSharedLookup(true, ['W1'])).toBe(true)
    expect(needsSharedLookup(true, [])).toBe(false)
    expect(needsSharedLookup(false, ['W1'])).toBe(false)
  })
})
