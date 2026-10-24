import { initTRPC, TRPCError } from '@trpc/server'
import { auth } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { ZodError } from 'zod'
import type { Session } from 'next-auth'
import { DEFAULT_TZ, isValidTZ } from '@/lib/tz'
import { computeVisibility, needsSharedLookup, resolveMyWorkspaceIds, type RawProject } from '@/lib/visibility'
import { leaksInternals, SAFE_INTERNAL_MESSAGE } from '@/lib/safe-errors'

/**
 * Server-side context cache.
 *
 * On a warm container:
 *   - Cache HIT  → 0 DB queries before any procedure runs
 *   - Cache MISS → 2 DB queries (user row + workspaces+projects combined)
 *
 * Before this change tasks.list + tasks.stats each added an extra
 * "SELECT id FROM projects WHERE workspace_id IN (...)" query on
 * every call, making the common case 3 round-trips instead of 1.
 *
 * TTL: 30 s. The cache is per Cloud Run instance and invalidateCtxCache() only reaches the
 * instance that handled the change, so the TTL is also the worst-case time a demoted or
 * removed person keeps stale access on the OTHER instances — keep it short.
 * Call invalidateCtxCache(email) on project create/delete to bust early on this instance.
 * Visibility rules live in src/lib/visibility.ts (pure, unit-tested).
 */

export interface OrgSummary {
  id: string
  name: string
  slug: string
  workspace_type: 'personal' | 'team'
  plan: string
  role: 'owner' | 'admin' | 'member'
  /** true → members see every project of the empresas where they have a sombrero. */
  workspace_scoped: boolean
}

type CtxCache = {
  me: { id: string; org_id: string; role: string }
  workspaceIds: string[]
  myWorkspaceIds: string[]   // empresas where I have an active sombrero (workspace_members)
  projectIds: string[]       // role-filtered default visibility (admin=all, member=memberships)
  allOrgProjectIds: string[] // unfiltered — used by admin "ver todo el org" toggle
  myMembershipIds: string[]  // explicit memberships — used by admin "mis proyectos" toggle
  tz: string                 // resolved timezone for THIS user (user.tz ?? org.tz ?? default)
  myOrgs: OrgSummary[]       // all orgs this user belongs to (for the switcher)
  activeOrg: OrgSummary       // the org currently in use
  expiresAt: number
}
// Cache key is `email:active_org_id` because switching workspaces must yield a
// completely different ctx (different projects, role, plan, etc).
const _ctxCache = new Map<string, CtxCache>()

const CTX_TTL_MS = 30 * 1000 // 30 seconds (see the note above)

/** Call when a project is created/deleted or membership changes — busts every
 *  active-org variant for this email so the next request re-fetches. */
export function invalidateCtxCache(email: string) {
  for (const k of _ctxCache.keys()) {
    if (k.startsWith(`${email}::`)) _ctxCache.delete(k)
  }
}

/** Abort a Supabase query after `ms` milliseconds. */
function supabaseTimeout(ms: number) {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, clear: () => clearTimeout(tid) }
}

const SUPABASE_TIMEOUT_MS = 5000 // 5 s — enough for Supabase free-tier wake-up attempts

/**
 * Context is created ONCE per HTTP request (shared across all batched procedures).
 *
 * Fast-path priority:
 *   1. ctx cache HIT  → 0 DB queries
 *   2. JWT has supabaseId/orgId → skip users-table query; only 1 query (workspaces)
 *   3. Fallback → 2 DB queries (users + workspaces)
 *
 * Timeout: both Supabase queries abort after 5 s.  If the workspace query
 * times out, we throw so tRPC returns HTTP 500 → React Query retries
 * (retry: 2) while the page keeps showing skeletons.  This is far better
 * than a 7-second hang that ends in an unretried 401.
 *
 * `preloadedSession` is supplied by the Route Handler, which calls auth()
 * at the top level where Next.js's AsyncLocalStorage context is guaranteed.
 * Calling auth() inside fetchRequestHandler's createContext callback can
 * return null because the async context may not propagate correctly.
 */
export const createTRPCContext = async (preloadedSession?: Session | null, headers?: Headers) => {
  const session = preloadedSession !== undefined ? preloadedSession : await auth()
  const supabase = createAdminSupabaseClient()

  // Browser-detected TZ — sent via `x-faro-tz` header by the tRPC client link
  // (see src/components/providers.tsx). Used to auto-set users.timezone the
  // first time a user calls the API and as a fallback for org-default mismatch.
  const browserTz = headers?.get('x-faro-tz') ?? null
  const browserTzValid = browserTz && isValidTZ(browserTz) ? browserTz : null

  // Active workspace cookie: faro:active_org. Set by the workspace switcher;
  // read here to override users.last_active_org_id. Falls back gracefully.
  // We don't use cookies() here because it requires the dynamic Headers API
  // and this runs on every tRPC request — parsing the Cookie header directly
  // is faster and works in both edge + node runtimes.
  const cookieHeader = headers?.get('cookie') ?? ''
  const activeOrgMatch = /(?:^|;\s*)faro:active_org=([^;]+)/.exec(cookieHeader)
  const requestedActiveOrgId = activeOrgMatch ? decodeURIComponent(activeOrgMatch[1]) : null

  let me: { id: string; org_id: string; role: string } | null = null
  let workspaceIds: string[] = []
  let myWorkspaceIds: string[] = []
  let projectIds: string[] = []
  let allOrgProjectIds: string[] = []
  let myMembershipIds: string[] = []
  let tz: string = DEFAULT_TZ
  let myOrgs: OrgSummary[] = []
  let activeOrg: OrgSummary | null = null

  if (session?.user?.email) {
    const email = session.user.email
    const now = Date.now()
    // Cache key includes the cookie-requested org so a switch yields a fresh
    // ctx with no carryover. Empty string for "no cookie" so it groups all
    // pre-switch requests together.
    const cacheKey = `${email}::${requestedActiveOrgId ?? ''}`
    const cached = _ctxCache.get(cacheKey)

    if (cached && cached.expiresAt > now) {
      // ── Warm path: zero DB queries ──────────────────────────────────────
      // Role and membership changes reach this instance within CTX_TTL_MS (30 s), so the warm
      // path does not re-read the role.
      me = cached.me
      workspaceIds = cached.workspaceIds
      myWorkspaceIds = cached.myWorkspaceIds
      projectIds = cached.projectIds
      allOrgProjectIds = cached.allOrgProjectIds
      myMembershipIds = cached.myMembershipIds
      tz = cached.tz
      myOrgs = cached.myOrgs
      activeOrg = cached.activeOrg
    } else {
      // ── Cold path ────────────────────────────────────────────────────────

      // Step 1: resolve Supabase user ID.
      // If supabaseId/orgId are in the JWT (set at sign-in time) we skip the
      // users-table query entirely — saves 1 round-trip on every cold hit.
      const sessionUser = session.user as {
        supabaseId?: string; orgId?: string; email: string
      }

      let userId: string | null = sessionUser.supabaseId ?? null
      let orgId: string | null = sessionUser.orgId ?? null
      let role: string | null = null

      // We ALWAYS need a fresh role from DB (the JWT doesn't carry it and
      // a stale role would let a demoted user keep admin visibility).
      // Even on the JWT-supabaseId fast-path, we hit the users table to read role.
      let userTz: string | null = null
      let lastActiveOrgId: string | null = null
      {
        const { signal, clear } = supabaseTimeout(SUPABASE_TIMEOUT_MS)
        try {
          const { data: user, error } = await supabase
            .from('users')
            .select('id, org_id, role, timezone, last_active_org_id')
            .eq('email', email)
            .abortSignal(signal)
            .single()
          clear()

          if (error && error.code !== 'PGRST116') {
            console.error('[tRPC ctx] users lookup error:', error.code, error.message)
            throw new Error(error.message)
          }

          if (user) {
            userId = user.id
            orgId = user.org_id
            role = user.role
            userTz = (user as { timezone?: string | null }).timezone ?? null
            lastActiveOrgId = (user as { last_active_org_id?: string | null }).last_active_org_id ?? null
          } else {
            // ── User authenticated but not in Supabase ────────────────────
            // Happens when signIn callback ran while Supabase was paused.
            // Recover by provisioning a Personal workspace on the fly (mirrors
            // src/lib/auth.ts signIn callback exactly).
            console.warn('[tRPC ctx] authenticated user missing from DB — creating:', email)
            const name = session.user?.name ?? email.split('@')[0]
            const slug = `${email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`

            const { data: org, error: orgErr } = await supabase
              .from('organizations')
              .insert({
                name: `${name} (Personal)`,
                slug,
                workspace_type: 'personal',
                plan: 'free',
              })
              .select('id')
              .single()

            if (orgErr) {
              console.error('[tRPC ctx] org creation failed:', orgErr.message)
              throw new Error(orgErr.message)
            }

            if (org) {
              const { data: newUser, error: userErr } = await supabase
                .from('users')
                .insert({
                  email,
                  name,
                  org_id: org.id,
                  last_active_org_id: org.id,
                  role: 'owner',
                  avatar_url: (session.user?.image as string | undefined) ?? null,
                  google_id: (session.user?.googleId as string | undefined) ?? null,
                })
                .select('id, org_id, role')
                .single()

              if (userErr) {
                console.error('[tRPC ctx] user creation failed:', userErr.message)
              } else if (newUser) {
                userId = newUser.id
                orgId = newUser.org_id
                role = newUser.role
                // Owner backfill + membership + default workspace (best-effort).
                await Promise.all([
                  supabase.from('organizations').update({ owner_user_id: newUser.id }).eq('id', org.id),
                  supabase.from('org_memberships').insert({ user_id: newUser.id, org_id: org.id, role: 'owner' }),
                  supabase.from('workspaces').insert({ org_id: org.id, name: 'Main' }),
                ])
                console.log('[tRPC ctx] user auto-created:', userId)
              }
            }
          }
        } catch (err) {
          clear()
          console.error('[tRPC ctx] users lookup timed out / failed:', err)
          throw err
        }
      }

      let membershipsFailed = false
      if (userId && orgId && role) {
        // Step 1b: fetch user's org memberships → the workspace switcher.
        // Embed organizations so we have name/plan/type without a 2nd query.
        // If a user has no memberships (legacy users pre-migration) we fall
        // back to a synthetic membership built from users.org_id so the app
        // keeps working.
        const { signal: msSig, clear: msClear } = supabaseTimeout(SUPABASE_TIMEOUT_MS)
        try {
          const { data: memberships, error: msErr } = await supabase
            .from('org_memberships')
            .select('role, org_id, organizations(id, name, slug, workspace_type, plan, workspace_scoped_visibility)')
            .eq('user_id', userId)
            .abortSignal(msSig)
          msClear()
          membershipsFailed = !!msErr

          type MembershipRow = {
            role: 'owner' | 'admin' | 'member'
            org_id: string
            organizations: { id: string; name: string; slug: string; workspace_type: 'personal' | 'team'; plan: string; workspace_scoped_visibility: boolean | null } | null
          }
          const rows = (memberships ?? []) as unknown as MembershipRow[]
          myOrgs = rows
            .filter(r => r.organizations)
            .map(r => ({
              id: r.organizations!.id,
              name: r.organizations!.name,
              slug: r.organizations!.slug,
              workspace_type: r.organizations!.workspace_type,
              plan: r.organizations!.plan,
              role: r.role,
              workspace_scoped: r.organizations!.workspace_scoped_visibility ?? false,
            }))

          // Legacy fallback — ONLY when the lookup itself failed. An empty result means the person
          // was removed from every grupo: rebuilding access from users.org_id would undo the removal.
          if (myOrgs.length === 0 && membershipsFailed) {
            const { data: fallbackOrg } = await supabase
              .from('organizations')
              .select('id, name, slug, workspace_type, plan, workspace_scoped_visibility')
              .eq('id', orgId)
              .single()
            if (fallbackOrg) {
              myOrgs = [{
                id: fallbackOrg.id,
                name: fallbackOrg.name,
                slug: fallbackOrg.slug,
                workspace_type: fallbackOrg.workspace_type as 'personal' | 'team',
                plan: fallbackOrg.plan,
                role: (role === 'owner' || role === 'admin') ? role as 'owner' | 'admin' : 'member',
                workspace_scoped: (fallbackOrg as { workspace_scoped_visibility?: boolean | null }).workspace_scoped_visibility ?? false,
              }]
            }
          }
        } catch (err) {
          msClear()
          console.error('[tRPC ctx] memberships lookup failed:', err)
        }

        if (myOrgs.length === 0 && !membershipsFailed) {
          // No grupo at all → no access (protectedProcedure answers UNAUTHORIZED).
          return {
            session, supabase, me: null,
            workspaceIds: [] as string[], myWorkspaceIds: [] as string[], projectIds: [] as string[],
            allOrgProjectIds: [] as string[], myMembershipIds: [] as string[],
            tz, myOrgs: [] as OrgSummary[], activeOrg: null as OrgSummary | null,
          }
        }

        // Resolve the active org:
        //   1. Cookie request, if the user is actually a member of it
        //   2. users.last_active_org_id if still a member
        //   3. users.org_id (legacy default)
        //   4. First membership available
        const memberOrgIds = new Set(myOrgs.map(o => o.id))
        const resolvedActiveOrgId =
          (requestedActiveOrgId && memberOrgIds.has(requestedActiveOrgId)) ? requestedActiveOrgId :
          (lastActiveOrgId && memberOrgIds.has(lastActiveOrgId)) ? lastActiveOrgId :
          memberOrgIds.has(orgId) ? orgId :
          (myOrgs[0]?.id ?? orgId)

        activeOrg = myOrgs.find(o => o.id === resolvedActiveOrgId) ?? null

        // Override orgId + role to reflect the ACTIVE workspace, not the
        // user's default. Everything downstream queries against this org.
        orgId = resolvedActiveOrgId
        if (activeOrg) role = activeOrg.role

        // Persist the choice to users.last_active_org_id when it differs —
        // fire-and-forget, never block the request.
        if (lastActiveOrgId !== resolvedActiveOrgId) {
          void supabase
            .from('users')
            .update({ last_active_org_id: resolvedActiveOrgId })
            .eq('id', userId)
        }

        me = { id: userId, org_id: orgId, role }

        // Step 2: workspaces + ALL org project IDs (always — admins use them,
        // members use them to validate "do I have access to this project").
        // Also pull org.timezone so we can resolve `tz` without an extra query.
        const { signal, clear } = supabaseTimeout(SUPABASE_TIMEOUT_MS)
        try {
          const [{ data: workspaces, error: wsErr }, { data: org }] = await Promise.all([
            supabase
              .from('workspaces')
              .select('id, projects(id, visibility, created_by)')
              .eq('org_id', orgId)
              .abortSignal(signal),
            supabase
              .from('organizations')
              .select('timezone')
              .eq('id', orgId)
              .abortSignal(signal)
              .single(),
          ])
          clear()
          // A failed lookup must abort (and stay out of the cache): treating it as "no
          // workspaces" would hide every project for the whole TTL.
          if (wsErr) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `workspaces lookup failed: ${wsErr.message}`, cause: wsErr })
          }

          workspaceIds = workspaces?.map(w => w.id) ?? []
          // Flatten projects across workspaces; computeVisibility() buckets them by visibility
          // once the user's memberships are known (private needs an explicit invite, personal
          // is creator-only — admin role bypasses neither).
          type RawWithEmbed = Omit<RawProject, 'workspace_id'>
          const rawProjects: RawProject[] = workspaces?.flatMap(w =>
            ((w.projects as RawWithEmbed[] | null) ?? []).map(p => ({ ...p, workspace_id: w.id }))
          ) ?? []
          allOrgProjectIds = rawProjects.map(p => p.id) // temporary, refined below

          // Resolve effective TZ: user override → org default → hardcoded fallback.
          const orgTz = (org as { timezone?: string | null } | null)?.timezone ?? null
          tz = userTz ?? orgTz ?? DEFAULT_TZ

          // Auto-set user.timezone from the browser on first call. Fire-and-forget
          // — never block the request on this. Stops happening once the column
          // is populated (which is exactly what we want).
          if (!userTz && browserTzValid && browserTzValid !== tz) {
            void supabase
              .from('users')
              .update({ timezone: browserTzValid })
              .eq('id', userId)
            tz = browserTzValid  // Use it immediately for this request
          }

          // Step 3: explicit project memberships + my sombreros (empresas where I wear a hat), in
          // parallel. Any error aborts the request and skips the cache: reading a failed lookup as
          // "no memberships" would silently hide the user's projects for the whole TTL.
          const [{ data: memberships, error: pmErr }, { data: wsMemberships, error: wmErr }] = await Promise.all([
            supabase.from('project_members').select('project_id').eq('user_id', userId),
            supabase.from('workspace_members').select('workspace_id').eq('user_id', userId).eq('is_active', true),
          ])
          if (pmErr) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `project_members lookup failed: ${pmErr.message}`, cause: pmErr })
          if (wmErr) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `workspace_members lookup failed: ${wmErr.message}`, cause: wmErr })

          myWorkspaceIds = resolveMyWorkspaceIds(workspaceIds, (wsMemberships ?? []).map(m => m.workspace_id))

          // Step 4: projects shared with my empresas — only workspace-scoped orgs (grupo mode) use them.
          const workspaceScoped = activeOrg?.workspace_scoped ?? false
          let sharedProjectIds: string[] = []
          if (needsSharedLookup(workspaceScoped, myWorkspaceIds)) {
            const { data: shared, error: spErr } = await supabase
              .from('project_workspaces')
              .select('project_id')
              .in('workspace_id', myWorkspaceIds)
            if (spErr) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `project_workspaces lookup failed: ${spErr.message}`, cause: spErr })
            sharedProjectIds = (shared ?? []).map(r => r.project_id)
          }

          // Step 5: the visibility rules (pure, unit-tested in src/lib/visibility.test.ts).
          const visibility = computeVisibility({
            userId,
            role,
            rawProjects,
            memberProjectIds: (memberships ?? []).map(m => m.project_id),
            myWorkspaceIds,
            workspaceScoped,
            sharedProjectIds,
          })
          allOrgProjectIds = visibility.allOrgProjectIds
          myMembershipIds = visibility.myMembershipIds
          projectIds = visibility.projectIds

          // Only cache under a cookie that was honoured: a junk faro:active_org value must not
          // mint cache entries (it would grow the Map and skip the cache for real requests).
          if (activeOrg && (!requestedActiveOrgId || requestedActiveOrgId === resolvedActiveOrgId)) {
            if (_ctxCache.size > 2000) _ctxCache.clear()
            _ctxCache.set(cacheKey, {
              me,
              workspaceIds,
              myWorkspaceIds,
              projectIds,
              allOrgProjectIds,
              myMembershipIds,
              tz,
              myOrgs,
              activeOrg,
              expiresAt: now + CTX_TTL_MS,
            })
          }
        } catch (err) {
          clear()
          console.error('[tRPC ctx] workspaces lookup timed out / failed:', err)
          throw err
        }
      }
    }
  }

  return { session, supabase, me, workspaceIds, myWorkspaceIds, projectIds, allOrgProjectIds, myMembershipIds, tz, myOrgs, activeOrg }
}

const t = initTRPC.context<typeof createTRPCContext>().create({
  errorFormatter({ shape, error }) {
    // Structured server-side log on every tRPC error. Cloud Logging picks
    // these up as JSON entries with `severity:ERROR` so they're filterable
    // in the GCP console. Keeps cause + path + ZodError detail.
    //
    // We do NOT log 4xx client-fault errors (bad input, unauthorized) to
    // keep signal high — only 5xx + INTERNAL_SERVER_ERROR are worth
    // attention.
    const code = error.code
    const isServerFault =
      code === 'INTERNAL_SERVER_ERROR' ||
      code === 'TIMEOUT' ||
      (typeof shape.data.httpStatus === 'number' && shape.data.httpStatus >= 500)
    if (isServerFault) {
      // Use console.error so Cloud Logging marks the entry severity:ERROR
      console.error(JSON.stringify({
        severity: 'ERROR',
        message: error.message,
        code: error.code,
        path: shape.data.path,
        stack: error.cause instanceof Error ? error.cause.stack : undefined,
        cause: error.cause instanceof Error ? error.cause.message : undefined,
        causeCode: (error.cause as { code?: unknown } | undefined)?.code,
        causeDetails: (error.cause as { details?: unknown; hint?: unknown } | undefined)?.details,
        causeHint: (error.cause as { hint?: unknown } | undefined)?.hint,
      }))
    }
    return {
      ...shape,
      // The full message stays in the server log above; the client gets a safe one.
      message: leaksInternals(error) ? SAFE_INTERNAL_MESSAGE : shape.message,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

export const createTRPCRouter = t.router
export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.email || !ctx.me) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session as NonNullable<typeof ctx.session> & {
        user: NonNullable<typeof ctx.session.user>
      },
      me: ctx.me as { id: string; org_id: string; role: string },
      workspaceIds: ctx.workspaceIds,
      myWorkspaceIds: ctx.myWorkspaceIds,
      projectIds: ctx.projectIds,
      allOrgProjectIds: ctx.allOrgProjectIds,
      myMembershipIds: ctx.myMembershipIds,
      tz: ctx.tz,
      myOrgs: ctx.myOrgs,
      activeOrg: ctx.activeOrg,
    },
  })
})
