'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BellOff, Building2, FolderKanban, Hash, Layers, Lock, MessageCircle, Plus, Search, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from '@/components/ui/toaster'
import { relativeTime } from '@/components/chat/chat-utils'
import { UserAvatar } from '@/components/chat/user-avatar'
import type { BrowsableChannel, ChannelItem, ChannelsData } from '@/components/chat/types'

export interface SelectOptions {
  messageId?: string
  threadId?: string
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1 pt-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-graphite">{children}</h3>
      {action}
    </div>
  )
}

function Badge({ unread, mentions }: { unread: number; mentions: number }) {
  if (unread <= 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {mentions > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white" title={`${mentions} ${mentions === 1 ? 'mención' : 'menciones'}`} aria-label={`${mentions} menciones`}>
          @
        </span>
      )}
      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-bold tabular-nums text-night">
        {unread > 99 ? '99+' : unread}
      </span>
    </span>
  )
}

function ChannelRow({ channel, selected, onSelect }: { channel: ChannelItem; selected: boolean; onSelect: () => void }) {
  const unread = channel.unread > 0 && !channel.muted
  const Icon = channel.projectId ? FolderKanban : channel.layer ? Layers : channel.workspaceId ? Building2 : channel.visibility === 'private' ? Lock : Hash
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors md:min-h-[36px]',
          selected ? 'bg-night text-mist dark:bg-night-700' : 'text-ink-body hover:bg-stone-100 dark:text-stone dark:hover:bg-night-700',
        )}
      >
        {channel.kind === 'dm' && channel.peer ? (
          <UserAvatar name={channel.peer.name} src={channel.peer.avatarUrl} className="h-5 w-5" />
        ) : (
          <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-signal' : 'text-graphite')} aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', unread ? 'font-bold' : 'font-medium')}>{channel.name}</span>
          {channel.lastMessage && (
            <span className={cn('block truncate text-xs', selected ? 'text-mist/70' : 'text-graphite')}>
              {channel.lastMessage.author ? `${channel.lastMessage.author.split(' ')[0]}: ` : ''}{channel.lastMessage.body}
            </span>
          )}
        </span>
        {channel.muted ? (
          <BellOff className="h-3.5 w-3.5 shrink-0 text-graphite" aria-label="Silenciado" />
        ) : (
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            {channel.lastMessage && !unread && <span className="text-[10px] text-graphite">{relativeTime(channel.lastMessage.at)}</span>}
            <Badge unread={channel.unread} mentions={channel.mentions} />
          </span>
        )}
      </button>
    </li>
  )
}

function SearchResults({ query, onSelect }: { query: string; onSelect: (channelId: string, opts: SelectOptions) => void }) {
  const search = trpc.chat.search.useQuery({ q: query }, { staleTime: 15_000 })
  if (search.isLoading) return <p className="px-3 py-4 text-sm text-graphite">Buscando…</p>
  if (search.error) return <p className="px-3 py-4 text-sm text-danger">{search.error.message}</p>
  const hits = search.data ?? []
  if (hits.length === 0) return <p className="px-3 py-4 text-sm text-graphite">Sin resultados para «{query}».</p>
  return (
    <ul className="space-y-0.5 p-1">
      {hits.map(h => (
        <li key={h.id}>
          <button
            type="button"
            onClick={() => onSelect(h.channelId, { messageId: h.parentId ?? h.id, threadId: h.parentId ?? undefined })}
            className="flex min-h-[44px] w-full flex-col items-start rounded-lg px-3 py-1.5 text-left hover:bg-stone-100 dark:hover:bg-night-700"
          >
            <span className="flex w-full items-baseline justify-between gap-2 text-[11px] text-graphite">
              <span className="truncate font-semibold">{h.channelName}{h.parentId ? ' · hilo' : ''}</span>
              <span className="shrink-0">{relativeTime(h.createdAt)}</span>
            </span>
            <span className="line-clamp-2 text-sm text-night dark:text-mist">
              {h.author && <span className="font-semibold">{h.author.split(' ')[0]}: </span>}{h.body}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function BrowsableRow({ channel, onJoin, pending }: { channel: BrowsableChannel; onJoin: () => void; pending: boolean }) {
  return (
    <li className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-1.5 md:min-h-[36px]">
      <Hash className="h-4 w-4 shrink-0 text-graphite" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-body dark:text-stone">{channel.name}</span>
        {channel.description && <span className="block truncate text-xs text-graphite">{channel.description}</span>}
      </span>
      <Button size="sm" variant="outline" onClick={onJoin} disabled={pending} className="h-8 shrink-0">
        Unirme
      </Button>
    </li>
  )
}

export function ChannelList({
  data,
  isLoading,
  error,
  selectedId,
  onSelect,
  onNewChannel,
  onNewDm,
  onRetry,
}: {
  data: ChannelsData | undefined
  isLoading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (channelId: string, opts?: SelectOptions) => void
  onNewChannel: () => void
  onNewDm: () => void
  onRetry: () => void
}) {
  const utils = trpc.useUtils()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])
  const searching = debounced.length >= 2

  const join = trpc.chat.join.useMutation({
    onSuccess: (_r, vars) => {
      void utils.chat.channels.invalidate()
      onSelect(vars.channelId)
    },
    onError: err => toast.error('No se pudo unir al canal', err.message),
  })

  const groups = useMemo(() => {
    const channels = (data?.channels ?? []).filter(c => c.kind === 'channel')
    const byName = (a: ChannelItem, b: ChannelItem) => a.name.localeCompare(b.name, 'es')
    return {
      general: channels.filter(c => c.slug === 'general'),
      others: channels.filter(c => c.slug !== 'general' && !c.workspaceId && !c.layer && !c.projectId).sort(byName),
      empresas: channels.filter(c => c.workspaceId && !c.projectId).sort(byName),
      capas: channels.filter(c => c.layer).sort(byName),
      proyectos: channels.filter(c => c.projectId).sort(byName),
      dms: (data?.channels ?? [])
        .filter(c => c.kind === 'dm')
        .sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? '') || a.name.localeCompare(b.name, 'es')),
    }
  }, [data])

  const renderGroup = (items: ChannelItem[]) =>
    items.map(c => <ChannelRow key={c.id} channel={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />)

  return (
    <nav aria-label="Canales y mensajes directos" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-stone px-3 py-3 dark:border-night-700">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.02em] text-night dark:text-mist">Chat</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onNewDm} aria-label="Nuevo mensaje directo" title="Nuevo mensaje directo" className="flex h-10 w-10 items-center justify-center rounded-md text-graphite hover:bg-stone-100 hover:text-night dark:hover:bg-night-700 dark:hover:text-mist md:h-8 md:w-8">
              <MessageCircle className="h-4 w-4" />
            </button>
            <button type="button" onClick={onNewChannel} aria-label="Nuevo canal" title="Nuevo canal" className="flex h-10 w-10 items-center justify-center rounded-md text-graphite hover:bg-stone-100 hover:text-night dark:hover:bg-night-700 dark:hover:text-mist md:h-8 md:w-8">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar en el chat…"
            aria-label="Buscar mensajes"
            className="h-10 w-full rounded-[10px] border border-stone bg-mist pl-9 pr-9 text-sm text-night placeholder:text-graphite focus:border-signal focus:bg-surface focus:outline-none focus:ring-2 focus:ring-signal/30 dark:border-night-700 dark:bg-night-700/50 dark:text-mist md:h-9"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Limpiar búsqueda" className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-graphite hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {searching ? (
          <SearchResults query={debounced} onSelect={(id, opts) => { setQ(''); onSelect(id, opts) }} />
        ) : isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-9 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />)}
          </div>
        ) : error ? (
          <div className="p-3">
            <EmptyState
              title="No se pudo cargar el chat"
              description={error}
              action={<Button variant="outline" size="sm" onClick={onRetry}>Reintentar</Button>}
              py={6}
            />
          </div>
        ) : (
          <>
            <SectionTitle>Canales</SectionTitle>
            <ul className="space-y-0.5">
              {renderGroup(groups.general)}
              {renderGroup(groups.others)}
            </ul>
            {groups.empresas.length > 0 && (
              <>
                <SectionTitle>Empresas</SectionTitle>
                <ul className="space-y-0.5">{renderGroup(groups.empresas)}</ul>
              </>
            )}
            {groups.capas.length > 0 && (
              <>
                <SectionTitle>Capas</SectionTitle>
                <ul className="space-y-0.5">{renderGroup(groups.capas)}</ul>
              </>
            )}
            {groups.proyectos.length > 0 && (
              <>
                <SectionTitle>Proyectos</SectionTitle>
                <ul className="space-y-0.5">{renderGroup(groups.proyectos)}</ul>
              </>
            )}

            <SectionTitle
              action={
                <button type="button" onClick={onNewDm} aria-label="Nuevo mensaje directo" className="flex h-6 w-6 items-center justify-center rounded text-graphite hover:text-night dark:hover:text-mist">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              }
            >
              Mensajes directos
            </SectionTitle>
            {groups.dms.length === 0 ? (
              <p className="px-3 py-2 text-xs text-graphite">Aún no tienes conversaciones directas.</p>
            ) : (
              <ul className="space-y-0.5">{renderGroup(groups.dms)}</ul>
            )}

            {!!data?.browsable.length && (
              <>
                <SectionTitle>Más canales</SectionTitle>
                <ul className="space-y-0.5">
                  {data.browsable.map(c => (
                    <BrowsableRow key={c.id} channel={c} pending={join.isPending && join.variables?.channelId === c.id} onJoin={() => join.mutate({ channelId: c.id })} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </nav>
  )
}
