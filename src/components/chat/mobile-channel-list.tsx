'use client'

import { useEffect, useMemo, useState } from 'react'
import { BellOff, Building2, FolderKanban, Hash, Layers, Lock, MessageCirclePlus, Plus, Search, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from '@/components/ui/toaster'
import { InsetGroup } from '@/components/mobile/inset-list'
import { MobileNavBar } from '@/components/mobile/nav-bar'
import { haptic } from '@/components/mobile/haptics'
import { relativeTime } from '@/components/chat/chat-utils'
import { useChatDirectory } from '@/components/chat/hooks'
import { UserAvatar } from '@/components/chat/user-avatar'
import type { ChannelItem, ChannelsData } from '@/components/chat/types'

interface SelectOptions {
  messageId?: string
  threadId?: string
}

/** Short clock/day label for the right edge of a conversation row ("14:05", "ayer", "12 oct"). */
function stamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  return relativeTime(iso).replace(/^hace /, '')
}

function Avatar({ channel, color }: { channel: ChannelItem; color?: string }) {
  if (channel.kind === 'dm' && channel.peer) return <UserAvatar name={channel.peer.name} src={channel.peer.avatarUrl} className="h-12 w-12 text-sm" />
  const Icon = channel.projectId ? FolderKanban : channel.layer ? Layers : channel.workspaceId ? Building2 : channel.visibility === 'private' ? Lock : Hash
  return (
    <span
      className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', !color && 'bg-night text-signal dark:bg-border-soft')}
      style={color ? { background: `${color}26`, color } : undefined}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  )
}

function ConversationRow({ channel, color, onOpen }: { channel: ChannelItem; color?: string; onOpen: () => void }) {
  const unread = channel.unread > 0 && !channel.muted
  return (
    <button
      type="button"
      onClick={() => { haptic(); onOpen() }}
      className="flex min-h-[72px] w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors active:bg-border-soft"
    >
      <Avatar channel={channel} color={color} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[16px] leading-snug text-foreground', unread ? 'font-bold' : 'font-semibold')}>{channel.name}</span>
          {channel.lastMessage && (
            <span className={cn('shrink-0 text-[12px] tabular-nums', unread ? 'font-semibold text-signal-ink' : 'text-graphite')}>{stamp(channel.lastMessage.at)}</span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={cn('truncate text-[14px] leading-snug', unread ? 'text-foreground' : 'text-graphite')}>
            {channel.lastMessage
              ? `${channel.lastMessage.author ? `${channel.lastMessage.author.split(' ')[0]}: ` : ''}${channel.lastMessage.body}`
              : (channel.description ?? 'Sin mensajes todavía')}
          </span>
          {channel.muted ? (
            <BellOff className="h-4 w-4 shrink-0 text-graphite" aria-label="Silenciado" />
          ) : unread ? (
            <span className="flex shrink-0 items-center gap-1">
              {channel.mentions > 0 && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white" aria-label={`${channel.mentions} menciones`}>@</span>}
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1.5 text-[11px] font-bold tabular-nums text-night">{channel.unread > 99 ? '99+' : channel.unread}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

function SearchHits({ query, onSelect }: { query: string; onSelect: (channelId: string, opts: SelectOptions) => void }) {
  const search = trpc.chat.search.useQuery({ q: query }, { staleTime: 15_000 })
  if (search.isLoading) return <p className="px-2 py-6 text-center text-sm text-graphite">Buscando…</p>
  if (search.error) return <p className="px-2 py-6 text-center text-sm text-danger">{search.error.message}</p>
  const hits = search.data ?? []
  if (hits.length === 0) return <p className="px-2 py-6 text-center text-sm text-graphite">Sin resultados para «{query}».</p>
  return (
    <InsetGroup label={`${hits.length} ${hits.length === 1 ? 'resultado' : 'resultados'}`}>
      {hits.map(h => (
        <button
          key={h.id}
          type="button"
          onClick={() => onSelect(h.channelId, { messageId: h.parentId ?? h.id, threadId: h.parentId ?? undefined })}
          className="block min-h-[64px] w-full px-4 py-2.5 text-left active:bg-border-soft"
        >
          <span className="flex items-baseline justify-between gap-2 text-[12px] text-graphite">
            <span className="truncate font-semibold">{h.channelName}{h.parentId ? ' · hilo' : ''}</span>
            <span className="shrink-0">{relativeTime(h.createdAt)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 text-[15px] text-foreground">
            {h.author && <span className="font-semibold">{h.author.split(' ')[0]}: </span>}{h.body}
          </span>
        </button>
      ))}
    </InsetGroup>
  )
}

/**
 * Phone version of the channel list — an iOS Messages / One UI conversation
 * list: large "Chat" title, search bar, grouped inset sections, 72px rows with
 * a 48px avatar, last message, time and unread badge.
 */
export function MobileChannelList({
  data, isLoading, error, onSelect, onNewChannel, onNewDm, onRetry,
}: {
  data: ChannelsData | undefined
  isLoading: boolean
  error: string | null
  onSelect: (channelId: string, opts?: SelectOptions) => void
  onNewChannel: () => void
  onNewDm: () => void
  onRetry: () => void
}) {
  const utils = trpc.useUtils()
  const { directory } = useChatDirectory()
  const colorOf = useMemo(() => new Map((directory?.workspaces ?? []).map(w => [w.id, w.color])), [directory])
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])
  const searching = debounced.length >= 2

  const join = trpc.chat.join.useMutation({
    onSuccess: (_r, vars) => { void utils.chat.channels.invalidate(); onSelect(vars.channelId) },
    onError: err => toast.error('No se pudo unir al canal', err.message),
  })

  const groups = useMemo(() => {
    const channels = (data?.channels ?? []).filter(c => c.kind === 'channel')
    const byName = (a: ChannelItem, b: ChannelItem) => a.name.localeCompare(b.name, 'es')
    return {
      canales: [...channels.filter(c => c.slug === 'general'), ...channels.filter(c => c.slug !== 'general' && !c.workspaceId && !c.layer && !c.projectId).sort(byName)],
      empresas: channels.filter(c => c.workspaceId && !c.projectId).sort(byName),
      capas: channels.filter(c => c.layer).sort(byName),
      proyectos: channels.filter(c => c.projectId).sort(byName),
      dms: (data?.channels ?? []).filter(c => c.kind === 'dm')
        .sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? '') || a.name.localeCompare(b.name, 'es')),
    }
  }, [data])

  const section = (label: string, items: ChannelItem[]) =>
    items.length > 0 && (
      <InsetGroup label={label}>
        {items.map(c => <ConversationRow key={c.id} channel={c} color={c.workspaceId ? colorOf.get(c.workspaceId) : undefined} onOpen={() => onSelect(c.id)} />)}
      </InsetGroup>
    )

  const pill = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium text-foreground active:bg-border-soft'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MobileNavBar
        title="Chat"
        actions={
          <>
            <button type="button" onClick={onNewDm} className={pill}><MessageCirclePlus className="h-4 w-4" />Mensaje directo</button>
            <button type="button" onClick={onNewChannel} className={pill}><Plus className="h-4 w-4" />Canal</button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-1">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-graphite" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar en el chat"
            aria-label="Buscar mensajes"
            enterKeyHint="search"
            className="h-11 w-full rounded-[12px] bg-border-soft pl-10 pr-10 text-[16px] text-foreground placeholder:text-graphite focus:outline-none focus:ring-2 focus:ring-signal/50"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-graphite">
              <X className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>

        {searching ? (
          <SearchHits query={debounced} onSelect={(id, opts) => { setQ(''); onSelect(id, opts) }} />
        ) : isLoading ? (
          <div className="overflow-hidden rounded-[14px] border border-border bg-surface" aria-busy>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex h-[72px] items-center gap-3.5 px-4">
                <div className="h-12 w-12 animate-pulse rounded-full bg-border-soft" />
                <div className="flex-1 space-y-2"><div className="h-3.5 w-1/2 animate-pulse rounded bg-border-soft" /><div className="h-3 w-3/4 animate-pulse rounded bg-border-soft" /></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState title="No se pudo cargar el chat" description={error} action={<Button variant="outline" size="sm" onClick={onRetry}>Reintentar</Button>} py={6} />
        ) : (
          <div className="space-y-5">
            {section('Canales', groups.canales)}
            {section('Empresas', groups.empresas)}
            {section('Capas', groups.capas)}
            {section('Proyectos', groups.proyectos)}
            <InsetGroup label="Mensajes directos">
              {groups.dms.length === 0 ? (
                <button type="button" onClick={onNewDm} className="flex min-h-[64px] w-full items-center gap-3 px-4 text-left text-[15px] text-graphite active:bg-border-soft">
                  <MessageCirclePlus className="h-5 w-5" /> Aún no tienes conversaciones. Escribe a alguien.
                </button>
              ) : groups.dms.map(c => <ConversationRow key={c.id} channel={c} onOpen={() => onSelect(c.id)} />)}
            </InsetGroup>
            {!!data?.browsable.length && (
              <InsetGroup label="Más canales">
                {data.browsable.map(c => (
                  <div key={c.id} className="flex min-h-[64px] items-center gap-3 px-4 py-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-border-soft text-graphite"><Hash className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-foreground">{c.name}</span>
                      {c.description && <span className="block truncate text-[13px] text-graphite">{c.description}</span>}
                    </span>
                    <Button size="sm" variant="outline" className="h-9 rounded-full px-4" disabled={join.isPending && join.variables?.channelId === c.id} onClick={() => join.mutate({ channelId: c.id })}>Unirme</Button>
                  </div>
                ))}
              </InsetGroup>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
