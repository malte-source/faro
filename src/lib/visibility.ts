/**
 * Project visibility — the rules that decide which projects a person can see.
 *
 * Pure on purpose: FARO has no RLS (the app talks to Postgres with the service
 * role), so this function IS the access-control boundary for every list and
 * every `ctx.projectIds.includes(id)` check. Keeping it free of I/O makes the
 * riskiest code in the app unit-testable (see visibility.test.ts); the tRPC
 * context only fetches rows and feeds them in.
 *
 * Rules:
 *  - `workspace` projects: visible to every member of the grupo/org.
 *  - `private` projects: only explicit project members — admins included.
 *  - `personal` projects: only the creator — admins included.
 *  - Default (what `ctx.projectIds` holds): owner/admin → every VISIBLE project
 *    of the org; everyone else → only the projects they are a member of.
 *  - Workspace-scoped orgs (grupo mode, e.g. La Trinchera) add, for non-admins,
 *    every visible project owned by or shared with an empresa where the person
 *    wears a sombrero. `private` / `personal` are still respected.
 */

export type ProjectVisibility = 'workspace' | 'private' | 'personal'

export interface RawProject {
  id: string
  visibility?: ProjectVisibility | null
  created_by?: string | null
  workspace_id?: string
}

/** Roles that see ALL visible projects of the org by default (everyone else: memberships only). */
export const ADMIN_ROLES = new Set(['owner', 'admin'])

export interface VisibilityInput {
  userId: string
  /** Role in the ACTIVE org (owner | admin | member…). */
  role: string
  /** Every project of the org's workspaces, with its visibility and creator. */
  rawProjects: RawProject[]
  /** Projects the user is an explicit member of (`project_members`). */
  memberProjectIds: Iterable<string>
  /** Empresas where the user has an active sombrero, already limited to this org's workspaces. */
  myWorkspaceIds: string[]
  /** Does the org use workspace-scoped visibility? */
  workspaceScoped: boolean
  /** Projects shared (`project_workspaces`) with any of `myWorkspaceIds`. Ignored unless workspace-scoped. */
  sharedProjectIds?: Iterable<string>
}

export interface VisibilityResult {
  /** Every project the user may see in this org, honouring private/personal (admin role does not bypass them). */
  allOrgProjectIds: string[]
  /** Visible projects the user is an explicit member of. */
  myMembershipIds: string[]
  /** Default visibility: admin = allOrgProjectIds, member = memberships (+ empresa projects in scoped orgs). */
  projectIds: string[]
}

/** Active sombreros limited to the empresas of the org in use (a sombrero in another grupo grants nothing here). */
export function resolveMyWorkspaceIds(orgWorkspaceIds: string[], activeSombreroWorkspaceIds: string[]): string[] {
  const inOrg = new Set(orgWorkspaceIds)
  return activeSombreroWorkspaceIds.filter(id => inOrg.has(id))
}

/** Whether the shared-projects lookup is needed at all (saves a query for classic orgs). */
export function needsSharedLookup(workspaceScoped: boolean, myWorkspaceIds: string[]): boolean {
  return workspaceScoped && myWorkspaceIds.length > 0
}

export function computeVisibility(input: VisibilityInput): VisibilityResult {
  const { userId, role, rawProjects, myWorkspaceIds, workspaceScoped } = input
  const memberIdSet = new Set(input.memberProjectIds)

  const allOrgProjectIds = rawProjects
    .filter(p => {
      const v = p.visibility ?? 'workspace'
      if (v === 'personal') return p.created_by === userId
      if (v === 'private') return memberIdSet.has(p.id)
      return true
    })
    .map(p => p.id)

  // Intersect with the visibility-filtered org list as a safety net
  // (no cross-org or hidden-project leaks).
  const myMembershipIds = allOrgProjectIds.filter(id => memberIdSet.has(id))

  let memberVisible = myMembershipIds
  if (needsSharedLookup(workspaceScoped, myWorkspaceIds)) {
    const myWs = new Set(myWorkspaceIds)
    const sharedIds = new Set(input.sharedProjectIds ?? [])
    const visibleSet = new Set(allOrgProjectIds)
    const viaEmpresa = rawProjects
      .filter(p => visibleSet.has(p.id) && ((p.workspace_id && myWs.has(p.workspace_id)) || sharedIds.has(p.id)))
      .map(p => p.id)
    memberVisible = Array.from(new Set([...myMembershipIds, ...viaEmpresa]))
  }

  return {
    allOrgProjectIds,
    myMembershipIds,
    projectIds: ADMIN_ROLES.has(role) ? allOrgProjectIds : memberVisible,
  }
}
