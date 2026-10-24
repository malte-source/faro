import { invalidateCtxCache } from '@/lib/trpc/server'
import type { createAdminSupabaseClient } from '@/lib/supabase'

type Db = ReturnType<typeof createAdminSupabaseClient>

/**
 * Everything that must stop being true when someone leaves (or is removed
 * from) a grupo: FARO has no RLS, so access lives in rows — sombreros,
 * project memberships, chat memberships — and each one has to be revoked
 * explicitly, otherwise the person keeps seeing the grupo's data.
 *
 * Also re-points `users.org_id` (the legacy "home org", still used by Equipo)
 * to another grupo, or to a freshly provisioned Personal workspace if this was
 * their last one, so they never end up with no workspace at all.
 */
export async function cleanupAfterMembershipRemoved(supabase: Db, userId: string, orgId: string): Promise<void> {
  const { data: workspaces } = await supabase.from('workspaces').select('id').eq('org_id', orgId)
  const workspaceIds = (workspaces ?? []).map(w => w.id)

  if (workspaceIds.length) {
    await supabase.from('workspace_members').update({ is_active: false }).eq('user_id', userId).in('workspace_id', workspaceIds)
    const { data: projects } = await supabase.from('projects').select('id').in('workspace_id', workspaceIds)
    const projectIds = (projects ?? []).map(p => p.id)
    if (projectIds.length) await supabase.from('project_members').delete().eq('user_id', userId).in('project_id', projectIds)
  }

  const { data: channels } = await supabase.from('chat_channels').select('id').eq('org_id', orgId)
  const channelIds = (channels ?? []).map(c => c.id)
  if (channelIds.length) await supabase.from('chat_members').delete().eq('user_id', userId).in('channel_id', channelIds)

  const { data: user } = await supabase.from('users').select('id, email, name, org_id, last_active_org_id').eq('id', userId).maybeSingle()
  if (!user) return

  const { data: remaining } = await supabase.from('org_memberships').select('org_id').eq('user_id', userId)
  let nextOrg = remaining?.[0]?.org_id ?? null

  if (!nextOrg && user.org_id === orgId) {
    const slug = `${user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
    const { data: personal } = await supabase
      .from('organizations')
      .insert({ name: `${user.name} (Personal)`, slug, workspace_type: 'personal', plan: 'free', owner_user_id: user.id })
      .select('id')
      .single()
    if (personal) {
      await Promise.all([
        supabase.from('org_memberships').insert({ user_id: user.id, org_id: personal.id, role: 'owner' }),
        supabase.from('workspaces').insert({ org_id: personal.id, name: 'Main' }),
      ])
      nextOrg = personal.id
    }
  }

  if (nextOrg && (user.org_id === orgId || user.last_active_org_id === orgId)) {
    await supabase.from('users').update({ org_id: nextOrg, last_active_org_id: nextOrg }).eq('id', userId)
  }
  invalidateCtxCache(user.email)
}
