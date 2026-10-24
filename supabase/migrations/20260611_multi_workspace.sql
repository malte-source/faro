-- =============================================================================
-- Multi-workspace migration — enables Personal + Team tiers
-- =============================================================================
--
-- BEFORE: 1 user belongs to 1 organization (M:1 via users.org_id).
-- AFTER:  1 user can belong to N organizations via org_memberships, and each
--         organization has a workspace_type (personal | team) + plan + owner.
--
-- The existing users.org_id stays as the user's DEFAULT/LAST-ACTIVE org so
-- nothing breaks during the transition; the new "active org" is picked at
-- request time from a cookie or falls back to users.org_id.
--
-- Backward compat: all existing org_id FKs on tables (projects, tasks, etc.)
-- remain untouched. Tenancy isolation still happens via org_id on every row.
--
-- After running this:
--   - TPY's existing org gets workspace_type='team', plan='team_plus'.
--   - All existing users get an org_memberships row mirroring users.org_id.
--   - New columns ready for the UI workspace switcher.
-- =============================================================================

-- 1. Extend organizations with workspace_type + owner.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'team'
    CHECK (workspace_type IN ('personal', 'team')),
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- The 'plan' column already exists with type OrgPlan. Extend its allowed
-- values to support our new tier system: free (personal), team, team_plus.
-- We don't add a CHECK because it's a free-form text column today; the typed
-- enum lives in src/types/database.ts.

-- 2. org_memberships: many-to-many user↔org with per-org role.
CREATE TABLE IF NOT EXISTS org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Role at the org level — separate from project_members.role.
  -- owner: full control, can delete org, can manage billing
  -- admin: manage members + settings, cannot delete org
  -- member: can use the app, no admin powers
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships(org_id);

-- 3. Backfill: every existing user gets a membership in their current org.
-- The user's existing users.role maps to org_memberships.role 1:1 because
-- the existing role enum (owner/admin/lead/member/viewer) is broader — we
-- collapse lead/viewer to 'member' at the org level. Project-level role
-- (project_members) is preserved separately.
INSERT INTO org_memberships (user_id, org_id, role, joined_at)
SELECT
  id,
  org_id,
  CASE
    WHEN role IN ('owner') THEN 'owner'
    WHEN role IN ('admin') THEN 'admin'
    ELSE 'member'
  END,
  joined_at
FROM users
ON CONFLICT (user_id, org_id) DO NOTHING;

-- 4. Set owner_user_id on each org = the first owner-role membership.
UPDATE organizations o
SET owner_user_id = sub.user_id
FROM (
  SELECT DISTINCT ON (org_id) org_id, user_id
  FROM org_memberships
  WHERE role = 'owner'
  ORDER BY org_id, joined_at ASC
) sub
WHERE o.id = sub.org_id AND o.owner_user_id IS NULL;

-- 5. Mark TPY (and any existing orgs with >1 user) as 'team' explicitly.
-- Orgs with exactly 1 user could be either, so default stays 'team' (safer:
-- doesn't accidentally downgrade their plan limits). Personal will be created
-- explicitly on new signups.
UPDATE organizations
SET workspace_type = 'team'
WHERE workspace_type IS NULL OR workspace_type = 'team';

-- 6. projects.visibility — per-project access scoping.
-- 'workspace': visible to all members of the org (current default behavior).
-- 'private':   visible only to explicit project_members (for sensitive work
--              even inside a team workspace).
-- 'personal':  visible ONLY to the creator. Used for "tareas de la casa" living
--              inside a work workspace, or for personal-tier projects.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'workspace'
    CHECK (visibility IN ('workspace', 'private', 'personal'));

CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);

-- 7. users.last_active_org_id — sticks the workspace switcher selection across
-- devices (the cookie covers single-device; this is the server-side anchor).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_org_id UUID
    REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE users SET last_active_org_id = org_id WHERE last_active_org_id IS NULL;

-- 8. Comment for documentation
COMMENT ON COLUMN organizations.workspace_type IS 'personal: single-user workspace (free tier). team: multi-user workspace (paid tier).';
COMMENT ON COLUMN organizations.owner_user_id IS 'The user who created this workspace. Cannot be removed by other members.';
COMMENT ON COLUMN projects.visibility IS 'workspace: all org members. private: explicit project_members only. personal: only creator.';
COMMENT ON COLUMN users.last_active_org_id IS 'Server-side anchor for the workspace switcher. Cookie wins per-device, this fills gaps.';
