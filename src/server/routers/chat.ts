import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { generateFlash } from '@/lib/gemini'
import { enforceRateLimit, tryConsume } from '@/lib/rate-limit'
import { requireFeature } from '@/lib/plan-limits'
import { notify } from '@/server/notify'
import { todayInTZ } from '@/lib/tz'
import { normalize } from '@/lib/multiempresa'
import { CAPTURE_TEXT_MAX_CHARS } from '@/lib/capture-schema'
import { ensureInboxProject, isDirection, loadPeople, visibleEmpresas, type EmpresaCtx } from '@/server/multiempresa'
import type { CorporateLayer } from '@/types/database'

/**
 * Chat interno — canales por empresa / capa / proyecto, DMs, hilos, menciones,
 * reacciones, mensaje → tarea y ayudas de IA ("¿qué me perdí?", @faro).
 *
 * Realtime = polling: la UI refresca el canal abierto cada pocos segundos y la
 * lista de canales cada ~20 s. Para un grupo de decenas de personas es más simple
 * y más robusto que Supabase Realtime (que exigiría RLS con auth de Supabase).
 */

const LAYER_LABEL: Record<CorporateLayer, string> = {
  gobierno: 'Gobierno',
  coe: 'Centros de Excelencia',
  sso: 'Servicios Compartidos',
  filial: 'Filiales',
}

const EMOJI = z.string().min(1).max(16)
const MESSAGE_PAGE = 60
/** Per sub-query cap of a delta; hitting it (or a cursor older than 15 min) asks the client for a full refetch. */
const DELTA_LIMIT = 100
const DELTA_MAX_AGE_MS = 15 * 60_000

function slugify(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'canal'
}

type Ctx = Parameters<typeof visibleEmpresas>[0] & {
  session: { user: { email?: string | null; name?: string | null } }
  tz: string
}

interface ChannelRow {
  id: string
  org_id: string
  kind: 'channel' | 'dm'
  slug: string | null
  name: string
  description: string | null
  visibility: 'public' | 'private'
  workspace_id: string | null
  project_id: string | null
  layer: CorporateLayer | null
  dm_key: string | null
  created_by: string | null
  archived_at: string | null
  created_at: string
}

const CHANNEL_COLS = 'id, org_id, kind, slug, name, description, visibility, workspace_id, project_id, layer, dm_key, created_by, archived_at, created_at'

/** Can this person see a channel's content *as a non-member* (public channels), given empresa/project gating? */
function publicAccessOk(ctx: EmpresaCtx, ch: Pick<ChannelRow, 'kind' | 'visibility' | 'workspace_id' | 'project_id'>): boolean {
  if (ch.kind !== 'channel' || ch.visibility !== 'public') return false
  if (ch.project_id && !(ctx as unknown as { projectIds: string[] }).projectIds.includes(ch.project_id)) return false
  if (ch.workspace_id && ctx.activeOrg?.workspace_scoped && !isDirection(ctx) && !ctx.myWorkspaceIds.includes(ch.workspace_id)) return false
  return true
}

async function loadChannel(ctx: Ctx, channelId: string): Promise<{ channel: ChannelRow; isMember: boolean; memberRole: string | null }> {
  if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
  const { data: ch } = await ctx.supabase.from('chat_channels').select(CHANNEL_COLS).eq('id', channelId).maybeSingle()
  const channel = ch as ChannelRow | null
  if (!channel || channel.org_id !== ctx.activeOrg.id || channel.archived_at) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'El canal no existe.' })
  }
  const { data: m } = await ctx.supabase
    .from('chat_members')
    .select('role')
    .eq('channel_id', channelId)
    .eq('user_id', ctx.me.id)
    .maybeSingle()
  const isMember = !!m
  // Public channels stay gated by empresa/project even for members (a lost sombrero or project
  // access ends reading); private channels and DMs are governed by membership alone.
  const gatedPublic = channel.kind === 'channel' && channel.visibility === 'public'
  if (gatedPublic ? !publicAccessOk(ctx, channel) : !isMember) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a este canal.' })
  }
  return { channel, isMember, memberRole: m?.role ?? null }
}

async function ensureMember(ctx: Ctx, channelId: string, userId: string, role: 'member' | 'admin' = 'member') {
  await ctx.supabase
    .from('chat_members')
    .upsert({ channel_id: channelId, user_id: userId, role }, { onConflict: 'channel_id,user_id', ignoreDuplicates: true })
}

interface UserLite { id: string; name: string; avatarUrl: string | null }

async function usersById(ctx: Ctx, ids: string[]): Promise<Map<string, UserLite>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const map = new Map<string, UserLite>()
  if (!unique.length) return map
  const { data } = await ctx.supabase.from('users').select('id, name, avatar_url').in('id', unique)
  for (const u of data ?? []) map.set(u.id, { id: u.id, name: u.name, avatarUrl: u.avatar_url })
  return map
}

interface MsgRow {
  id: string
  channel_id: string
  author_id: string | null
  kind: 'text' | 'system' | 'ai'
  body: string
  parent_id: string | null
  mentions: string[]
  mention_all: boolean
  task_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}
const MSG_COLS = 'id, channel_id, author_id, kind, body, parent_id, mentions, mention_all, task_id, edited_at, deleted_at, created_at'

/** Attach author, reactions (aggregated), reply counts and the linked task to raw message rows. */
async function shapeMessages(ctx: Ctx, rows: MsgRow[]) {
  if (!rows.length) return []
  const ids = rows.map(r => r.id)
  const [authors, { data: reactions }, { data: replies }, taskRes] = await Promise.all([
    usersById(ctx, rows.map(r => r.author_id ?? '')),
    ctx.supabase.from('chat_reactions').select('message_id, user_id, emoji').in('message_id', ids),
    ctx.supabase.from('chat_messages').select('parent_id, created_at, author_id').in('parent_id', ids).is('deleted_at', null),
    (() => {
      const taskIds = rows.map(r => r.task_id).filter((x): x is string => !!x)
      return taskIds.length
        ? ctx.supabase.from('tasks').select('id, title, status').in('id', taskIds)
        : Promise.resolve({ data: [] as Array<{ id: string; title: string; status: string }> })
    })(),
  ])

  const reactionMap = new Map<string, Map<string, { count: number; mine: boolean; users: string[] }>>()
  for (const r of reactions ?? []) {
    const perMsg = reactionMap.get(r.message_id) ?? new Map()
    const e = perMsg.get(r.emoji) ?? { count: 0, mine: false, users: [] }
    e.count++
    e.users.push(r.user_id)
    if (r.user_id === ctx.me.id) e.mine = true
    perMsg.set(r.emoji, e)
    reactionMap.set(r.message_id, perMsg)
  }
  const replyMap = new Map<string, { count: number; last: string; authors: Set<string> }>()
  for (const r of replies ?? []) {
    if (!r.parent_id) continue
    const e = replyMap.get(r.parent_id) ?? { count: 0, last: r.created_at, authors: new Set<string>() }
    e.count++
    if (r.created_at > e.last) e.last = r.created_at
    if (r.author_id) e.authors.add(r.author_id)
    replyMap.set(r.parent_id, e)
  }
  const replyAuthors = await usersById(ctx, Array.from(replyMap.values()).flatMap(v => Array.from(v.authors)))
  const taskMap = new Map((taskRes.data ?? []).map(t => [t.id, t]))

  return rows.map(r => {
    const deleted = !!r.deleted_at
    const rep = replyMap.get(r.id)
    return {
      id: r.id,
      channelId: r.channel_id,
      kind: r.kind,
      body: deleted ? '' : r.body,
      deleted,
      edited: !!r.edited_at,
      parentId: r.parent_id,
      createdAt: r.created_at,
      author: r.author_id ? (authors.get(r.author_id) ?? { id: r.author_id, name: 'Alguien', avatarUrl: null }) : null,
      mentionsMe: r.mention_all || r.mentions.includes(ctx.me.id),
      mentions: r.mentions,
      mine: r.author_id === ctx.me.id,
      reactions: Array.from(reactionMap.get(r.id)?.entries() ?? []).map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
      replyCount: rep?.count ?? 0,
      lastReplyAt: rep?.last ?? null,
      replyAuthors: rep ? Array.from(rep.authors).slice(0, 3).map(id => replyAuthors.get(id)).filter((u): u is UserLite => !!u) : [],
      task: r.task_id && taskMap.has(r.task_id) ? taskMap.get(r.task_id)! : null,
    }
  })
}

/** Resolve @mentions: ids picked in the composer (validated against the grupo) + @todos / @canal. */
async function resolveMentions(ctx: Ctx, body: string, picked: string[]) {
  const people = await loadPeople(ctx)
  const valid = new Set(people.map(p => p.id))
  const ids = new Set(picked.filter(id => valid.has(id) && id !== ctx.me.id))
  const mentionAll = /(^|\s)@(todos|todas|canal|all|channel)\b/i.test(body)
  return { mentions: Array.from(ids), mentionAll }
}

// ── Unread math ────────────────────────────────────────────────────────────

async function myChannels(ctx: Ctx) {
  if (!ctx.activeOrg) return []
  const { data, error } = await ctx.supabase
    .from('chat_members')
    .select(`channel_id, role, last_read_at, muted, channel:chat_channels!inner(${CHANNEL_COLS})`)
    .eq('user_id', ctx.me.id)
    .eq('channel.org_id', ctx.activeOrg.id)
    .is('channel.archived_at', null)
  if (error) throw error
  return ((data ?? []) as unknown as Array<{ channel_id: string; role: string; last_read_at: string; muted: boolean; channel: ChannelRow }>)
    // A sombrero/project lost since joining hides the channel (DMs and private ones stay).
    .filter(m => m.channel.visibility === 'private' || m.channel.kind === 'dm' || publicAccessOk(ctx, m.channel))
}

type LastMsg = Pick<MsgRow, 'body' | 'created_at' | 'author_id'>
type UnreadMap = Map<string, { unread: number; mentions: number; last: LastMsg | null }>

/**
 * Once the SQL function is known to be missing (the migration is applied by hand, after the code is
 * deployed) don't ask again on every poll: remember for a minute and use the JS path directly.
 */
let rpcMissingUntil = 0

/** One aggregate query in Postgres (supabase/migrations/20261027_chat_counts.sql): exact at any volume. */
async function unreadViaRpc(ctx: Ctx, memberships: Awaited<ReturnType<typeof myChannels>>): Promise<UnreadMap | null> {
  if (!ctx.activeOrg || Date.now() < rpcMissingUntil) return null
  const { data, error } = await ctx.supabase.rpc('chat_unread_counts', { p_user: ctx.me.id, p_org: ctx.activeOrg.id })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') rpcMissingUntil = Date.now() + 60_000
    return null
  }
  const byChannel = new Map((data ?? []).map(r => [r.channel_id, r]))
  const result: UnreadMap = new Map()
  for (const m of memberships) {
    const r = byChannel.get(m.channel_id)
    result.set(m.channel_id, {
      unread: Number(r?.unread ?? 0),
      mentions: Number(r?.mentions ?? 0),
      last: r?.last_message_at && r.last_message_body !== null
        ? { body: r.last_message_body, created_at: r.last_message_at, author_id: r.last_author_id ?? null }
        : null,
    })
  }
  return result
}

/**
 * Fallback (and the original implementation): scans up to 1,500 full messages and counts in JS. It
 * undercounts past the cap, which is why the SQL path above replaced it.
 */
async function unreadViaScan(ctx: Ctx, memberships: Awaited<ReturnType<typeof myChannels>>): Promise<UnreadMap> {
  const result: UnreadMap = new Map()
  if (!memberships.length) return result
  const minRead = memberships.reduce((min, m) => (m.last_read_at < min ? m.last_read_at : min), memberships[0].last_read_at)
  const floor = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const since = minRead > floor ? minRead : floor
  const { data } = await ctx.supabase
    .from('chat_messages')
    .select(MSG_COLS)
    .in('channel_id', memberships.map(m => m.channel_id))
    .gt('created_at', since)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1500)
  const readAt = new Map(memberships.map(m => [m.channel_id, m.last_read_at]))
  for (const m of memberships) result.set(m.channel_id, { unread: 0, mentions: 0, last: null })
  for (const msg of (data ?? []) as MsgRow[]) {
    const e = result.get(msg.channel_id)!
    if (!e.last && !msg.parent_id) e.last = msg
    if (msg.author_id === ctx.me.id) continue
    if (msg.created_at > (readAt.get(msg.channel_id) ?? '')) {
      e.unread++
      if (msg.mention_all || msg.mentions.includes(ctx.me.id)) e.mentions++
    }
  }
  return result
}

async function unreadByChannel(ctx: Ctx, memberships: Awaited<ReturnType<typeof myChannels>>): Promise<UnreadMap> {
  if (!memberships.length) return new Map()
  return (await unreadViaRpc(ctx, memberships)) ?? (await unreadViaScan(ctx, memberships))
}

// ── Router ─────────────────────────────────────────────────────────────────

/**
 * Tell people about a new message: everyone else in a DM; mentioned people (or everyone, for @todos) in a
 * channel. Muted memberships are skipped. Never throws (notify swallows its own failures).
 */
async function notifyMessage(ctx: Ctx, channel: ChannelRow, msg: MsgRow, parentId?: string) {
  const { data: members } = await ctx.supabase.from('chat_members').select('user_id, muted').eq('channel_id', channel.id)
  const muted = new Set((members ?? []).filter(m => m.muted).map(m => m.user_id))
  const live = (members ?? []).filter(m => !m.muted && m.user_id !== ctx.me.id).map(m => m.user_id)
  const author = ctx.session.user.name ?? 'Alguien'
  const snippet = msg.body.replace(/\s+/g, ' ').trim().slice(0, 140)
  const url = `/dashboard/chat?c=${channel.id}&m=${msg.id}${parentId ? `&t=${parentId}` : ''}`

  if (channel.kind === 'dm') {
    await notify({
      supabase: ctx.supabase,
      orgId: channel.org_id,
      userIds: live,
      kind: 'dm',
      title: author,
      body: snippet,
      url,
      entity: { type: 'chat', id: channel.id },
      actorId: ctx.me.id,
    })
    return
  }

  const targets = new Set<string>()
  const liveSet = new Set(live)
  for (const id of msg.mentions) {
    if (muted.has(id) || id === ctx.me.id) continue
    // Members always; people who are not members only when the channel is public (they can read it).
    if (liveSet.has(id) || channel.visibility === 'public') targets.add(id)
  }
  if (msg.mention_all) for (const id of live) targets.add(id)
  if (!targets.size) return

  await notify({
    supabase: ctx.supabase,
    orgId: channel.org_id,
    userIds: Array.from(targets),
    kind: 'mention',
    title: `${author} te mencionó en #${channel.name}`,
    body: snippet,
    url,
    entity: { type: 'chat', id: msg.id },
    actorId: ctx.me.id,
  })
}

export const chatRouter = createTRPCRouter({
  /**
   * Idempotent: make sure the default channels exist (General, one per empresa,
   * one per capa corporativa in use) and that the caller is in the ones that
   * belong to them. Called once when the chat opens.
   */
  bootstrap: protectedProcedure.mutation(async ({ ctx }) => {
    const org = ctx.activeOrg
    if (!org) throw new TRPCError({ code: 'NOT_FOUND' })
    const direction = isDirection(ctx)

    const [{ data: existing }, { data: empresas }, { data: orgUsers }] = await Promise.all([
      ctx.supabase.from('chat_channels').select('id, slug').eq('org_id', org.id).not('slug', 'is', null),
      ctx.workspaceIds.length
        ? ctx.supabase.from('workspaces').select('id, name').in('id', ctx.workspaceIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      ctx.supabase.from('org_memberships').select('user_id, corporate_layer').eq('org_id', org.id),
    ])
    const bySlug = new Map((existing ?? []).map(c => [c.slug as string, c.id]))

    const wanted: Array<{ slug: string; name: string; description: string; visibility: 'public' | 'private'; workspace_id?: string; layer?: CorporateLayer }> = [
      { slug: 'general', name: 'General', description: 'Todo el grupo. Avisos y conversación abierta.', visibility: 'public' },
    ]
    for (const e of empresas ?? []) {
      wanted.push({ slug: `empresa-${slugify(e.name)}`, name: e.name, description: `Canal de ${e.name}.`, visibility: 'public', workspace_id: e.id })
    }
    // The layer is stored PER GRUPO on org_memberships: users.corporate_layer is global and any
    // admin of someone's Personal workspace could set it, so it must never grant channel access.
    const layerMembers = new Map<CorporateLayer, string[]>()
    for (const row of (orgUsers ?? []) as Array<{ user_id: string; corporate_layer: CorporateLayer | null }>) {
      if (!row.corporate_layer) continue
      layerMembers.set(row.corporate_layer, [...(layerMembers.get(row.corporate_layer) ?? []), row.user_id])
    }
    for (const layer of layerMembers.keys()) {
      wanted.push({ slug: `capa-${layer}`, name: LAYER_LABEL[layer], description: `Canal de ${LAYER_LABEL[layer]}.`, visibility: 'private', layer })
    }

    const missing = wanted.filter(w => !bySlug.has(w.slug))
    if (missing.length) {
      const { data: created } = await ctx.supabase
        .from('chat_channels')
        .upsert(
          missing.map(w => ({ org_id: org.id, kind: 'channel' as const, created_by: ctx.me.id, ...w })),
          { onConflict: 'org_id,slug', ignoreDuplicates: true },
        )
        .select('id, slug')
      for (const c of created ?? []) if (c.slug) bySlug.set(c.slug, c.id)
      // ignoreDuplicates hides rows that raced in; re-read what is still missing.
      const stillMissing = missing.filter(w => !bySlug.has(w.slug))
      if (stillMissing.length) {
        const { data } = await ctx.supabase.from('chat_channels').select('id, slug').eq('org_id', org.id).in('slug', stillMissing.map(w => w.slug))
        for (const c of data ?? []) if (c.slug) bySlug.set(c.slug, c.id)
      }
    }

    // Memberships: General for everyone; empresa channels for my sombreros (Dirección: all); capa channels for their layer members.
    const mine = new Set<string>()
    const general = bySlug.get('general')
    if (general) mine.add(general)
    for (const e of empresas ?? []) {
      const id = bySlug.get(`empresa-${slugify(e.name)}`)
      if (id && (direction || ctx.myWorkspaceIds.includes(e.id))) mine.add(id)
    }
    const myLayerRows = Array.from(layerMembers.entries()).filter(([, ids]) => ids.includes(ctx.me.id)).map(([l]) => l)
    for (const l of myLayerRows) {
      const id = bySlug.get(`capa-${l}`)
      if (id) mine.add(id)
    }
    // Private capa channels must also contain their other members.
    const rowsToAdd: Array<{ channel_id: string; user_id: string }> = []
    for (const [layer, ids] of layerMembers) {
      const channelId = bySlug.get(`capa-${layer}`)
      if (!channelId) continue
      for (const uid of ids) rowsToAdd.push({ channel_id: channelId, user_id: uid })
    }
    for (const channel_id of mine) rowsToAdd.push({ channel_id, user_id: ctx.me.id })
    if (rowsToAdd.length) {
      await ctx.supabase.from('chat_members').upsert(rowsToAdd, { onConflict: 'channel_id,user_id', ignoreDuplicates: true })
    }
    return { ok: true, channels: bySlug.size }
  }),

  /** Sidebar of the chat: my channels and DMs with unread counters + public channels I could join. */
  channels: protectedProcedure.query(async ({ ctx }) => {
    const org = ctx.activeOrg
    if (!org) return { channels: [], browsable: [] }
    const memberships = await myChannels(ctx)
    const unread = await unreadByChannel(ctx, memberships)

    const dmIds = memberships.filter(m => m.channel.kind === 'dm').map(m => m.channel_id)
    const peers = new Map<string, UserLite>()
    if (dmIds.length) {
      const { data } = await ctx.supabase
        .from('chat_members')
        .select('channel_id, user:users(id, name, avatar_url)')
        .in('channel_id', dmIds)
        .neq('user_id', ctx.me.id)
      for (const r of (data ?? []) as unknown as Array<{ channel_id: string; user: { id: string; name: string; avatar_url: string | null } | null }>) {
        if (r.user) peers.set(r.channel_id, { id: r.user.id, name: r.user.name, avatarUrl: r.user.avatar_url })
      }
    }
    const lastAuthors = await usersById(ctx, Array.from(unread.values()).map(u => u.last?.author_id ?? ''))

    const channels = memberships.map(m => {
      const u = unread.get(m.channel_id)!
      const peer = peers.get(m.channel_id) ?? null
      return {
        id: m.channel.id,
        kind: m.channel.kind,
        name: m.channel.kind === 'dm' ? (peer?.name ?? 'Mensaje directo') : m.channel.name,
        slug: m.channel.slug,
        description: m.channel.description,
        visibility: m.channel.visibility,
        workspaceId: m.channel.workspace_id,
        projectId: m.channel.project_id,
        layer: m.channel.layer,
        muted: m.muted,
        unread: u.unread,
        mentions: u.mentions,
        peer,
        lastMessage: u.last
          ? { body: u.last.body.slice(0, 120), at: u.last.created_at, author: u.last.author_id ? (lastAuthors.get(u.last.author_id)?.name ?? null) : null }
          : null,
      }
    })

    const joined = new Set(memberships.map(m => m.channel_id))
    const { data: pub } = await ctx.supabase
      .from('chat_channels')
      .select(CHANNEL_COLS)
      .eq('org_id', org.id)
      .eq('kind', 'channel')
      .eq('visibility', 'public')
      .is('archived_at', null)
      .order('name')
    const browsable = ((pub ?? []) as ChannelRow[])
      .filter(c => !joined.has(c.id) && publicAccessOk(ctx, c))
      .map(c => ({ id: c.id, name: c.name, description: c.description, workspaceId: c.workspace_id, projectId: c.project_id }))

    return { channels, browsable }
  }),

  /** Sidebar badge. */
  unreadTotal: protectedProcedure.query(async ({ ctx }) => {
    const memberships = (await myChannels(ctx)).filter(m => !m.muted)
    const unread = await unreadByChannel(ctx, memberships)
    let total = 0, mentions = 0
    for (const u of unread.values()) { total += u.unread; mentions += u.mentions }
    return { total, mentions }
  }),

  /**
   * Latest top-level messages of a channel (or older ones with `before`).
   *
   * With `after` (the previous answer's `asOf`, minus a small overlap) it answers a DELTA instead of the
   * whole page: only the rows that changed since — new messages, edits, deletions, new reactions, and
   * parents whose thread got/lost a reply — so an open channel polls cheaply. `reset: true` tells the
   * client the gap is too big (long sleep, busy channel) and it should re-fetch the full page. A removed
   * reaction leaves no timestamp, so clients also re-fetch the full page on a slow timer.
   */
  messages: protectedProcedure
    .input(z.object({ channelId: z.string().uuid(), before: z.string().optional(), after: z.string().datetime().optional() }))
    .query(async ({ ctx, input }) => {
      const asOf = new Date().toISOString() // taken BEFORE the queries: nothing between two polls can fall through
      const { channel, isMember } = await loadChannel(ctx, input.channelId)
      const channelInfo = { id: channel.id, kind: channel.kind, name: channel.name, description: channel.description, visibility: channel.visibility, isMember }

      if (input.after) {
        const after = input.after
        if (Date.now() - Date.parse(after) > DELTA_MAX_AGE_MS) {
          return { channel: channelInfo, messages: [], hasMore: false, lastReadAt: null, asOf, delta: true, reset: true }
        }
        const id = input.channelId
        const [created, changed, replies, reacted] = await Promise.all([
          ctx.supabase.from('chat_messages').select('id').eq('channel_id', id).is('parent_id', null).gt('created_at', after).limit(DELTA_LIMIT),
          ctx.supabase.from('chat_messages').select('id').eq('channel_id', id).is('parent_id', null).or(`edited_at.gt.${after},deleted_at.gt.${after}`).limit(DELTA_LIMIT),
          ctx.supabase.from('chat_messages').select('parent_id').eq('channel_id', id).not('parent_id', 'is', null).or(`created_at.gt.${after},deleted_at.gt.${after}`).limit(DELTA_LIMIT),
          ctx.supabase.from('chat_reactions').select('message_id, msg:chat_messages!inner(channel_id, parent_id)').eq('msg.channel_id', id).is('msg.parent_id', null).gt('created_at', after).limit(DELTA_LIMIT),
        ])
        const failed = created.error ?? changed.error ?? replies.error ?? reacted.error
        if (failed) throw failed
        const ids = new Set<string>()
        let overflow = false
        for (const set of [created.data ?? [], changed.data ?? [], replies.data ?? [], reacted.data ?? []]) if (set.length >= DELTA_LIMIT) overflow = true
        for (const r of created.data ?? []) ids.add(r.id)
        for (const r of changed.data ?? []) ids.add(r.id)
        for (const r of replies.data ?? []) if (r.parent_id) ids.add(r.parent_id)
        for (const r of reacted.data ?? []) ids.add(r.message_id)
        if (overflow) return { channel: channelInfo, messages: [], hasMore: false, lastReadAt: null, asOf, delta: true, reset: true }
        if (ids.size === 0) return { channel: channelInfo, messages: [], hasMore: false, lastReadAt: null, asOf, delta: true, reset: false }

        const { data: rows, error } = await ctx.supabase.from('chat_messages').select(MSG_COLS).in('id', Array.from(ids)).is('parent_id', null)
        if (error) throw error
        return {
          channel: channelInfo,
          messages: await shapeMessages(ctx, (rows ?? []) as MsgRow[]),
          hasMore: false,
          lastReadAt: null,
          asOf,
          delta: true,
          reset: false,
        }
      }

      let q = ctx.supabase
        .from('chat_messages')
        .select(MSG_COLS)
        .eq('channel_id', input.channelId)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE + 1)
      if (input.before) q = q.lt('created_at', input.before)
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as MsgRow[]
      const hasMore = rows.length > MESSAGE_PAGE
      const page = rows.slice(0, MESSAGE_PAGE).reverse()
      const { data: mem } = isMember
        ? await ctx.supabase.from('chat_members').select('last_read_at').eq('channel_id', input.channelId).eq('user_id', ctx.me.id).maybeSingle()
        : { data: null }
      return {
        channel: channelInfo,
        messages: await shapeMessages(ctx, page),
        hasMore,
        lastReadAt: mem?.last_read_at ?? null,
        asOf,
        delta: false,
        reset: false,
      }
    }),

  /**
   * A thread: the root message and its replies. With `after` (see `messages`) it answers a delta: the
   * root is always re-sent (its reply count and reactions move) plus only the replies that changed.
   */
  thread: protectedProcedure
    .input(z.object({ parentId: z.string().uuid(), after: z.string().datetime().optional() }))
    .query(async ({ ctx, input }) => {
      const asOf = new Date().toISOString()
      const { data: root } = await ctx.supabase.from('chat_messages').select(MSG_COLS).eq('id', input.parentId).maybeSingle()
      if (!root) throw new TRPCError({ code: 'NOT_FOUND' })
      await loadChannel(ctx, (root as MsgRow).channel_id)

      if (input.after) {
        const after = input.after
        if (Date.now() - Date.parse(after) > DELTA_MAX_AGE_MS) {
          const [shapedRoot] = await shapeMessages(ctx, [root as MsgRow])
          return { root: shapedRoot, replies: [], asOf, delta: true, reset: true }
        }
        const [changed, reacted] = await Promise.all([
          ctx.supabase.from('chat_messages').select('id').eq('parent_id', input.parentId).or(`created_at.gt.${after},edited_at.gt.${after},deleted_at.gt.${after}`).limit(DELTA_LIMIT),
          ctx.supabase.from('chat_reactions').select('message_id, msg:chat_messages!inner(parent_id)').eq('msg.parent_id', input.parentId).gt('created_at', after).limit(DELTA_LIMIT),
        ])
        const failed = changed.error ?? reacted.error
        if (failed) throw failed
        const overflow = (changed.data ?? []).length >= DELTA_LIMIT || (reacted.data ?? []).length >= DELTA_LIMIT
        const ids = new Set<string>()
        for (const r of changed.data ?? []) ids.add(r.id)
        for (const r of reacted.data ?? []) ids.add(r.message_id)
        let replyRows: MsgRow[] = []
        if (!overflow && ids.size > 0) {
          const { data, error } = await ctx.supabase.from('chat_messages').select(MSG_COLS).in('id', Array.from(ids)).eq('parent_id', input.parentId)
          if (error) throw error
          replyRows = (data ?? []) as MsgRow[]
        }
        const shaped = await shapeMessages(ctx, [root as MsgRow, ...replyRows])
        return { root: shaped[0], replies: shaped.slice(1), asOf, delta: true, reset: overflow }
      }

      const { data: replies } = await ctx.supabase
        .from('chat_messages')
        .select(MSG_COLS)
        .eq('parent_id', input.parentId)
        .order('created_at', { ascending: true })
        .limit(300)
      const shaped = await shapeMessages(ctx, [root as MsgRow, ...((replies ?? []) as MsgRow[])])
      return { root: shaped[0], replies: shaped.slice(1), asOf, delta: false, reset: false }
    }),

  send: protectedProcedure
    .input(z.object({
      channelId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
      parentId: z.string().uuid().optional(),
      mentionIds: z.array(z.string().uuid()).max(30).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!tryConsume(`${ctx.me.id}:chatSend`, { tokensPerMinute: 60, maxBurst: 30 })) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Estás enviando mensajes muy rápido. Espera unos segundos.' })
      }
      const { channel, isMember } = await loadChannel(ctx, input.channelId)
      if (input.parentId) {
        const { data: parent } = await ctx.supabase.from('chat_messages').select('channel_id, parent_id').eq('id', input.parentId).maybeSingle()
        if (!parent || parent.channel_id !== channel.id || parent.parent_id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ese mensaje no admite respuestas.' })
        }
      }
      if (!isMember) await ensureMember(ctx, channel.id, ctx.me.id)

      const { mentions, mentionAll } = await resolveMentions(ctx, input.body, input.mentionIds)
      const { data, error } = await ctx.supabase
        .from('chat_messages')
        .insert({
          channel_id: channel.id,
          author_id: ctx.me.id,
          body: input.body,
          parent_id: input.parentId ?? null,
          mentions,
          mention_all: mentionAll,
        })
        .select(MSG_COLS)
        .single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      await ctx.supabase.from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('channel_id', channel.id).eq('user_id', ctx.me.id)
      await notifyMessage(ctx, channel, data as MsgRow, input.parentId)
      return (await shapeMessages(ctx, [data as MsgRow]))[0]
    }),

  edit: protectedProcedure
    .input(z.object({
      messageId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
      mentionIds: z.array(z.string().uuid()).max(30).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: msg } = await ctx.supabase.from('chat_messages').select('author_id, channel_id, deleted_at, mentions').eq('id', input.messageId).maybeSingle()
      if (!msg || msg.deleted_at) throw new TRPCError({ code: 'NOT_FOUND' })
      if (msg.author_id !== ctx.me.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo puedes editar tus mensajes.' })
      await loadChannel(ctx, msg.channel_id)
      // Keep prior mentions whose name is still in the text; add newly picked ones.
      const people = await loadPeople(ctx)
      const stillThere = (msg.mentions ?? []).filter(id => {
        const name = people.find(p => p.id === id)?.name
        return name ? normalize(input.body).includes(`@${normalize(name.split(' ')[0])}`) : false
      })
      const { mentions, mentionAll } = await resolveMentions(ctx, input.body, [...stillThere, ...(input.mentionIds ?? [])])
      await ctx.supabase.from('chat_messages').update({ body: input.body, edited_at: new Date().toISOString(), mentions, mention_all: mentionAll }).eq('id', input.messageId)
      return { ok: true }
    }),

  remove: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: msg } = await ctx.supabase.from('chat_messages').select('author_id, channel_id').eq('id', input.messageId).maybeSingle()
      if (!msg) throw new TRPCError({ code: 'NOT_FOUND' })
      const { memberRole } = await loadChannel(ctx, msg.channel_id)
      if (msg.author_id !== ctx.me.id && memberRole !== 'admin' && !isDirection(ctx)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo puedes borrar tus mensajes.' })
      }
      await ctx.supabase.from('chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', input.messageId)
      return { ok: true }
    }),

  react: protectedProcedure
    .input(z.object({ messageId: z.string().uuid(), emoji: EMOJI }))
    .mutation(async ({ ctx, input }) => {
      const { data: msg } = await ctx.supabase.from('chat_messages').select('channel_id').eq('id', input.messageId).maybeSingle()
      if (!msg) throw new TRPCError({ code: 'NOT_FOUND' })
      await loadChannel(ctx, msg.channel_id)
      const { data: have } = await ctx.supabase
        .from('chat_reactions').select('emoji').eq('message_id', input.messageId).eq('user_id', ctx.me.id).eq('emoji', input.emoji).maybeSingle()
      if (have) {
        await ctx.supabase.from('chat_reactions').delete().eq('message_id', input.messageId).eq('user_id', ctx.me.id).eq('emoji', input.emoji)
        return { active: false }
      }
      await ctx.supabase.from('chat_reactions').insert({ message_id: input.messageId, user_id: ctx.me.id, emoji: input.emoji })
      return { active: true }
    }),

  markRead: protectedProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.supabase
        .from('chat_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('channel_id', input.channelId)
        .eq('user_id', ctx.me.id)
      return { ok: true }
    }),

  setMuted: protectedProcedure
    .input(z.object({ channelId: z.string().uuid(), muted: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.supabase.from('chat_members').update({ muted: input.muted }).eq('channel_id', input.channelId).eq('user_id', ctx.me.id)
      return { ok: true }
    }),

  createChannel: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(2).max(60),
      description: z.string().trim().max(240).optional(),
      visibility: z.enum(['public', 'private']).default('public'),
      memberIds: z.array(z.string().uuid()).max(100).default([]),
      workspaceId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.activeOrg
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' })
      if (input.workspaceId) {
        const visible = await visibleEmpresas(ctx)
        if (!visible.some(e => e.id === input.workspaceId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a esa empresa.' })
      }
      const people = await loadPeople(ctx)
      const valid = new Set(people.map(p => p.id))
      const slug = `canal-${slugify(input.name)}`
      const { data, error } = await ctx.supabase
        .from('chat_channels')
        .insert({
          org_id: org.id, kind: 'channel', slug, name: input.name, description: input.description ?? null,
          visibility: input.visibility, workspace_id: input.workspaceId ?? null, created_by: ctx.me.id,
        })
        .select('id')
        .single()
      if (error) {
        if (error.code === '23505') throw new TRPCError({ code: 'CONFLICT', message: 'Ya existe un canal con ese nombre.' })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
      const members = Array.from(new Set(input.memberIds.filter(id => valid.has(id) && id !== ctx.me.id)))
      await ctx.supabase.from('chat_members').insert([
        { channel_id: data.id, user_id: ctx.me.id, role: 'admin' as const },
        ...members.map(user_id => ({ channel_id: data.id, user_id })),
      ])
      return { id: data.id }
    }),

  /** Find or create the DM with a person of the grupo. */
  openDm: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.activeOrg
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' })
      if (input.userId === ctx.me.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No puedes escribirte a ti mismo.' })
      const people = await loadPeople(ctx)
      const peer = people.find(p => p.id === input.userId)
      if (!peer) throw new TRPCError({ code: 'NOT_FOUND', message: 'Esa persona no es parte del grupo.' })
      const dmKey = [ctx.me.id, input.userId].sort().join(':')
      const { data: have } = await ctx.supabase.from('chat_channels').select('id').eq('org_id', org.id).eq('dm_key', dmKey).maybeSingle()
      let id = have?.id
      if (!id) {
        const { data, error } = await ctx.supabase
          .from('chat_channels')
          .insert({ org_id: org.id, kind: 'dm', name: 'dm', visibility: 'private', dm_key: dmKey, created_by: ctx.me.id })
          .select('id')
          .single()
        if (error) {
          // Raced with the other person opening it at the same moment.
          const { data: again } = await ctx.supabase.from('chat_channels').select('id').eq('org_id', org.id).eq('dm_key', dmKey).maybeSingle()
          if (!again) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          id = again.id
        } else {
          id = data.id
        }
      }
      await ctx.supabase.from('chat_members').upsert(
        [{ channel_id: id, user_id: ctx.me.id }, { channel_id: id, user_id: input.userId }],
        { onConflict: 'channel_id,user_id', ignoreDuplicates: true },
      )
      return { id }
    }),

  /** Chat of a project (created on demand, open to everyone who can see the project). */
  openProjectChannel: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.activeOrg
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!ctx.projectIds.includes(input.projectId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a ese proyecto.' })
      const { data: project } = await ctx.supabase.from('projects').select('id, name, code, workspace_id').eq('id', input.projectId).single()
      if (!project) throw new TRPCError({ code: 'NOT_FOUND' })
      const slug = `proyecto-${project.id.slice(0, 8)}`
      const { data: have } = await ctx.supabase.from('chat_channels').select('id').eq('org_id', org.id).eq('slug', slug).maybeSingle()
      let id = have?.id
      if (!id) {
        const { data } = await ctx.supabase
          .from('chat_channels')
          .upsert(
            { org_id: org.id, kind: 'channel', slug, name: `${project.code} · ${project.name}`, description: `Conversación del proyecto ${project.name}.`,
              visibility: 'public', project_id: project.id, workspace_id: project.workspace_id, created_by: ctx.me.id },
            { onConflict: 'org_id,slug' },
          )
          .select('id')
          .single()
        id = data?.id
      }
      if (!id) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      await ensureMember(ctx, id, ctx.me.id)
      return { id }
    }),

  join: protectedProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { channel, isMember } = await loadChannel(ctx, input.channelId)
      if (!isMember) await ensureMember(ctx, channel.id, ctx.me.id)
      return { ok: true }
    }),

  leave: protectedProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { channel } = await loadChannel(ctx, input.channelId)
      if (channel.kind === 'dm' || channel.slug === 'general') throw new TRPCError({ code: 'BAD_REQUEST', message: 'No puedes salir de este canal.' })
      await ctx.supabase.from('chat_members').delete().eq('channel_id', channel.id).eq('user_id', ctx.me.id)
      return { ok: true }
    }),

  /** Add people to a (private) channel you belong to. */
  addMembers: protectedProcedure
    .input(z.object({ channelId: z.string().uuid(), userIds: z.array(z.string().uuid()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const { channel, isMember } = await loadChannel(ctx, input.channelId)
      if (!isMember || channel.kind === 'dm') throw new TRPCError({ code: 'FORBIDDEN' })
      if (channel.visibility !== 'private') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Los canales públicos no necesitan invitaciones: cada persona se une sola.' })
      }
      const valid = new Set((await loadPeople(ctx)).map(p => p.id))
      const rows = input.userIds.filter(id => valid.has(id)).map(user_id => ({ channel_id: channel.id, user_id }))
      if (rows.length) await ctx.supabase.from('chat_members').upsert(rows, { onConflict: 'channel_id,user_id', ignoreDuplicates: true })
      return { added: rows.length }
    }),

  members: protectedProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadChannel(ctx, input.channelId)
      const { data } = await ctx.supabase
        .from('chat_members')
        .select('role, user:users(id, name, avatar_url)')
        .eq('channel_id', input.channelId)
      return ((data ?? []) as unknown as Array<{ role: string; user: { id: string; name: string; avatar_url: string | null } | null }>)
        .filter(r => r.user)
        .map(r => ({ id: r.user!.id, name: r.user!.name, avatarUrl: r.user!.avatar_url, role: r.role }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }),

  /** Search messages in the channels I belong to or can browse. */
  search: protectedProcedure
    .input(z.object({ q: z.string().trim().min(2).max(80) }))
    .query(async ({ ctx, input }) => {
      const memberships = await myChannels(ctx)
      const names = new Map(memberships.map(m => [m.channel_id, m.channel.kind === 'dm' ? 'Mensaje directo' : m.channel.name]))
      // Public channels I could join also count: search is how you discover what was said there.
      if (ctx.activeOrg) {
        const { data: pub } = await ctx.supabase
          .from('chat_channels')
          .select(CHANNEL_COLS)
          .eq('org_id', ctx.activeOrg.id)
          .eq('kind', 'channel')
          .eq('visibility', 'public')
          .is('archived_at', null)
        for (const c of (pub ?? []) as ChannelRow[]) if (!names.has(c.id) && publicAccessOk(ctx, c)) names.set(c.id, c.name)
      }
      if (!names.size) return []
      const escaped = input.q.replace(/[%_\\]/g, m => `\\${m}`)
      const { data } = await ctx.supabase
        .from('chat_messages')
        .select(MSG_COLS)
        .in('channel_id', Array.from(names.keys()))
        .ilike('body', `%${escaped}%`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(30)
      const rows = (data ?? []) as MsgRow[]
      const authors = await usersById(ctx, rows.map(r => r.author_id ?? ''))
      return rows.map(r => ({
        id: r.id,
        channelId: r.channel_id,
        channelName: names.get(r.channel_id) ?? '',
        parentId: r.parent_id,
        body: r.body,
        author: r.author_id ? (authors.get(r.author_id)?.name ?? null) : null,
        createdAt: r.created_at,
      }))
    }),

  /**
   * Turn a message into a task. Defaults: title = first line, responsable = the
   * first person mentioned (else you), empresa = the channel's empresa. The
   * message gets a ✓ marker and the thread a system note.
   */
  toTask: protectedProcedure
    .input(z.object({
      messageId: z.string().uuid(),
      title: z.string().trim().min(1).max(160).optional(),
      assigneeId: z.string().uuid().nullish(),
      workspaceId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = ctx.activeOrg
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' })
      const { data: msg } = await ctx.supabase.from('chat_messages').select(MSG_COLS).eq('id', input.messageId).maybeSingle()
      if (!msg || (msg as MsgRow).deleted_at) throw new TRPCError({ code: 'NOT_FOUND' })
      const m = msg as MsgRow
      const { channel } = await loadChannel(ctx, m.channel_id)
      if (m.task_id) throw new TRPCError({ code: 'CONFLICT', message: 'Este mensaje ya se convirtió en tarea.' })

      const [empresas, people] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
      const assigneeId = input.assigneeId === undefined ? (m.mentions[0] ?? ctx.me.id) : input.assigneeId
      if (assigneeId && !people.some(p => p.id === assigneeId)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Esa persona no es parte del grupo.' })

      let workspaceId = input.workspaceId ?? channel.workspace_id ?? null
      if (!workspaceId && input.projectId) {
        const { data: p } = await ctx.supabase.from('projects').select('workspace_id').eq('id', input.projectId).maybeSingle()
        workspaceId = p?.workspace_id ?? null
      }
      if (!workspaceId) workspaceId = people.find(p => p.id === assigneeId)?.memberships[0]?.workspaceId ?? (empresas.length === 1 ? empresas[0].id : null)
      if (!workspaceId || !empresas.some(e => e.id === workspaceId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Elige la empresa de la tarea.' })
      }

      const projectId = input.projectId ?? await ensureInboxProject({ ...ctx, activeOrg: org }, workspaceId, assigneeId ? [assigneeId] : [])
      if (input.projectId && !ctx.projectIds.includes(input.projectId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes acceso a ese proyecto.' })

      const firstLine = m.body.split('\n').map(l => l.trim()).find(Boolean) ?? 'Tarea desde el chat'
      const title = input.title ?? (firstLine.length > 100 ? `${firstLine.slice(0, 97)}…` : firstLine)
      const { data: task, error } = await ctx.supabase
        .from('tasks')
        .insert({
          project_id: projectId,
          workspace_id: workspaceId,
          title,
          description: `${m.body}\n\n— Desde el chat (${channel.kind === 'dm' ? 'mensaje directo' : `#${channel.name}`})`,
          assignee_id: assigneeId,
          reporter_id: ctx.me.id,
          priority: 'medium',
          status: 'todo',
          due_date: input.dueDate ?? null,
          position: Date.now(),
        })
        .select('id, title')
        .single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      await ctx.supabase.from('chat_messages').update({ task_id: task.id }).eq('id', m.id)
      const who = assigneeId ? (people.find(p => p.id === assigneeId)?.name ?? '') : 'sin responsable'
      await ctx.supabase.from('chat_messages').insert({
        channel_id: m.channel_id,
        parent_id: m.parent_id ?? m.id,
        kind: 'system',
        body: `Tarea creada: «${task.title}» → ${who}`,
        author_id: null,
      })
      return { taskId: task.id, title: task.title }
    }),

  /**
   * "¿Qué me perdí?" — summary of the unread messages of a channel (or of a
   * thread), with decisions, pendientes and questions aimed at the caller.
   */
  summarize: protectedProcedure
    .input(z.object({ channelId: z.string().uuid(), parentId: z.string().uuid().optional(), mode: z.enum(['unread', 'recent']).default('unread') }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Resumir el chat con IA')
      enforceRateLimit(`${ctx.me.id}:chatSummarize`)
      const { channel, isMember } = await loadChannel(ctx, input.channelId)

      let since: string | null = null
      if (input.mode === 'unread' && isMember && !input.parentId) {
        const { data: mem } = await ctx.supabase.from('chat_members').select('last_read_at').eq('channel_id', channel.id).eq('user_id', ctx.me.id).maybeSingle()
        since = mem?.last_read_at ?? null
      }
      let q = ctx.supabase.from('chat_messages').select(MSG_COLS).eq('channel_id', channel.id).is('deleted_at', null).eq('kind', 'text').order('created_at', { ascending: false }).limit(150)
      if (input.parentId) q = q.or(`id.eq.${input.parentId},parent_id.eq.${input.parentId}`)
      if (since) q = q.gt('created_at', since)
      const { data } = await q
      const rows = ((data ?? []) as MsgRow[]).reverse()
      if (rows.length === 0) return { summary: 'No hay mensajes nuevos que resumir.', count: 0 }

      const authors = await usersById(ctx, rows.map(r => r.author_id ?? ''))
      const people = await loadPeople(ctx)
      const nameOf = (id: string) => people.find(p => p.id === id)?.name ?? 'alguien'
      const meName = people.find(p => p.id === ctx.me.id)?.name ?? 'el usuario'
      const transcript = rows.map(r => {
        const stamp = new Date(r.created_at).toLocaleString('es', { timeZone: ctx.tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        const tag = r.mention_all || r.mentions.includes(ctx.me.id) ? ' [te menciona]' : ''
        const mentioned = r.mentions.length ? ` (menciona a ${r.mentions.map(nameOf).join(', ')})` : ''
        return `[${stamp}] ${r.author_id ? (authors.get(r.author_id)?.name ?? 'Alguien') : 'Sistema'}${tag}${mentioned}: ${r.body}`
      }).join('\n')

      const prompt = `Eres Faro, el asistente de un equipo. Resume esta conversación del chat interno (${channel.kind === 'dm' ? 'mensaje directo' : `canal «${channel.name}»`}) para ${meName}, que no la leyó. Escribe en español neutro latinoamericano, directo y breve.

Estructura (omite una sección si está vacía):
**Resumen** — 2 a 4 líneas con lo importante.
**Decisiones** — lista corta.
**Pendientes** — quién debe hacer qué (y para cuándo si se dijo).
**Para ti** — preguntas o pedidos dirigidos a ${meName} (los mensajes marcados [te menciona]).

No inventes nada que no esté en los mensajes. Hoy es ${todayInTZ(undefined, ctx.tz)}.

MENSAJES:
${transcript}`
      const summary = (await generateFlash(prompt, { temperature: 0.3 })).trim()
      return { summary, count: rows.length }
    }),

  /**
   * Plain-text transcript of a thread (or the latest messages of a channel),
   * ready to hand to Captura: the client sends it with capture.submitText and
   * lands on the review screen — "sacar tareas con IA" from a conversation.
   */
  transcript: protectedProcedure
    .input(z.object({ channelId: z.string().uuid(), parentId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const { channel } = await loadChannel(ctx, input.channelId)
      let q = ctx.supabase.from('chat_messages').select(MSG_COLS).eq('channel_id', channel.id).is('deleted_at', null).eq('kind', 'text').order('created_at', { ascending: false }).limit(80)
      q = input.parentId ? q.or(`id.eq.${input.parentId},parent_id.eq.${input.parentId}`) : q
      const { data } = await q
      const rows = ((data ?? []) as MsgRow[]).reverse()
      const authors = await usersById(ctx, rows.map(r => r.author_id ?? ''))
      const text = rows
        .map(r => `${authors.get(r.author_id ?? '')?.name ?? 'Alguien'}: ${r.body}`)
        .join('\n')
        .slice(-CAPTURE_TEXT_MAX_CHARS)
      return { text, count: rows.length, channelName: channel.kind === 'dm' ? 'Mensaje directo' : channel.name }
    }),

  /**
   * Answer a question aimed at Faro ("@faro …") as an AI message in the channel
   * or thread. Context: the latest messages of that conversation. Called by the
   * client right after sending a message that mentions @faro.
   */
  askFaro: protectedProcedure
    .input(z.object({ channelId: z.string().uuid(), parentId: z.string().uuid().optional(), question: z.string().trim().min(1).max(1500) }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Preguntarle a Faro en el chat')
      enforceRateLimit(`${ctx.me.id}:chatAskFaro`)
      const { channel } = await loadChannel(ctx, input.channelId)
      if (input.parentId) {
        const { data: parent } = await ctx.supabase.from('chat_messages').select('channel_id, parent_id').eq('id', input.parentId).maybeSingle()
        if (!parent || parent.channel_id !== channel.id || parent.parent_id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ese mensaje no admite respuestas.' })
        }
      }

      let q = ctx.supabase.from('chat_messages').select(MSG_COLS).eq('channel_id', channel.id).is('deleted_at', null).eq('kind', 'text').order('created_at', { ascending: false }).limit(40)
      q = input.parentId ? q.or(`id.eq.${input.parentId},parent_id.eq.${input.parentId}`) : q.is('parent_id', null)
      const { data } = await q
      const rows = ((data ?? []) as MsgRow[]).reverse()
      const [authors, empresas] = await Promise.all([usersById(ctx, rows.map(r => r.author_id ?? '')), visibleEmpresas(ctx)])
      const context = rows.map(r => `${r.author_id ? (authors.get(r.author_id)?.name ?? 'Alguien') : 'Sistema'}: ${r.body}`).join('\n')

      const prompt = `Eres Faro, asistente de gestión de proyectos dentro del chat interno de un grupo de empresas. Responde en español neutro latinoamericano, de forma breve, concreta y útil (máximo ~8 líneas). No puedes ejecutar acciones ni consultar datos fuera de esta conversación: si te piden crear tareas o consultar el estado de algo, di cómo hacerlo en Faro (botón «Convertir en tarea» del mensaje, la barra «Nueva tarea…», Capturar). Si no sabes algo, dilo.

Empresas del grupo: ${empresas.map(e => e.name).join(', ') || '—'}. Hoy es ${todayInTZ(undefined, ctx.tz)}.

CONVERSACIÓN RECIENTE:
${context}

PREGUNTA (de quien te mencionó): ${input.question}`
      const answer = (await generateFlash(prompt, { temperature: 0.4 })).trim()
      if (!answer) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Faro no pudo responder. Intenta de nuevo.' })

      const { data: msg, error } = await ctx.supabase
        .from('chat_messages')
        .insert({ channel_id: channel.id, parent_id: input.parentId ?? null, kind: 'ai', author_id: null, body: answer })
        .select(MSG_COLS)
        .single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      return (await shapeMessages(ctx, [msg as MsgRow]))[0]
    }),
})
