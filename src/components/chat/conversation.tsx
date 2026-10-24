'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellOff, ChevronLeft, Hash, Loader2, Lock, LogOut, MoreHorizontal, Sparkles, Users, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { Composer } from '@/components/chat/composer'
import { ExtractTasksButton } from '@/components/chat/extract-tasks-button'
import { useChannelMessages, usePageVisible, useMe, useSendMessage } from '@/components/chat/hooks'
import { MessageList } from '@/components/chat/message-list'
import { Popover } from '@/components/chat/popover'
import { RichText } from '@/components/chat/rich-text'
import { UserAvatar } from '@/components/chat/user-avatar'
import { ChannelInfoSheet } from '@/components/chat/mobile-chat-sheets'
import type { ChannelItem } from '@/components/chat/types'

interface Summary {
  text: string
  count: number
  mode: 'unread' | 'recent'
}

/**
 * The open channel: header (members, mute, leave, "¿Qué me perdí?", extract
 * tasks), message list, composer. Mount it with `key={channelId}` so all
 * per-channel state resets on switch.
 */
export function Conversation({
  channelId,
  channel,
  highlightMessageId,
  onHighlightDone,
  onOpenThread,
  onBack,
  onLeft,
}: {
  channelId: string
  channel: ChannelItem | undefined
  highlightMessageId: string | null
  onHighlightDone: () => void
  onOpenThread: (messageId: string) => void
  onBack: () => void
  onLeft: () => void
}) {
  const me = useMe()
  const visible = usePageVisible()
  const utils = trpc.useUtils()

  const query = useChannelMessages(channelId)
  const data = query.data
  const isMember = data?.channel.isMember ?? false
  const sendApi = useSendMessage({ channelId })

  const members = trpc.chat.members.useQuery({ channelId }, { staleTime: 60_000, enabled: !!data })
  const [membersOpen, setMembersOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)

  // ── Read state ───────────────────────────────────────────────────────────
  const markRead = useCallback(() => {
    void utils.client.chat.markRead
      .mutate({ channelId })
      .then(() => {
        void utils.chat.channels.invalidate()
        void utils.chat.unreadTotal.invalidate()
      })
      .catch(() => { /* a failed read marker is retried on the next message/focus */ })
  }, [utils, channelId])

  // On open and when leaving the channel.
  useEffect(() => {
    if (!isMember) return
    markRead()
    return () => markRead()
  }, [isMember, markRead])

  // New messages arriving while the page is visible and focused.
  const lastId = data?.messages.length ? data.messages[data.messages.length - 1].id : null
  const lastSeen = useRef<string | null>(null)
  useEffect(() => {
    if (!isMember || !lastId) return
    if (lastSeen.current !== null && lastSeen.current !== lastId && visible && document.hasFocus()) markRead()
    lastSeen.current = lastId
  }, [lastId, isMember, visible, markRead])

  // Coming back to the tab/window.
  useEffect(() => {
    if (!isMember) return
    const onFocus = () => { if (document.visibilityState === 'visible') markRead() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [isMember, markRead])

  // ── Actions ──────────────────────────────────────────────────────────────
  const summarize = trpc.chat.summarize.useMutation({
    onError: err => toast.error('No se pudo resumir', err.message),
  })
  const runSummary = (mode: 'unread' | 'recent') =>
    summarize.mutate({ channelId, mode }, { onSuccess: r => setSummary({ text: r.summary, count: r.count, mode }) })

  const setMuted = trpc.chat.setMuted.useMutation({
    onSuccess: () => void utils.chat.channels.invalidate(),
    onError: err => toast.error('No se pudo cambiar el silencio', err.message),
  })
  const leave = trpc.chat.leave.useMutation({
    onSuccess: () => {
      void utils.chat.channels.invalidate()
      void utils.chat.unreadTotal.invalidate()
      onLeft()
    },
    onError: err => toast.error('No se pudo salir del canal', err.message),
  })
  const join = trpc.chat.join.useMutation({
    onSuccess: () => {
      void utils.chat.messages.invalidate({ channelId })
      void utils.chat.channels.invalidate()
    },
    onError: err => toast.error('No se pudo unir al canal', err.message),
  })

  const handleLeave = async () => {
    const ok = await confirmAction({
      title: 'Salir del canal',
      description: 'Dejarás de recibir sus mensajes. Podrás volver a unirte si es público.',
      confirmLabel: 'Salir',
      variant: 'warning',
    })
    if (ok) leave.mutate({ channelId })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-14 items-center border-b border-stone px-3 pt-[env(safe-area-inset-top)] dark:border-night-700 md:px-4 md:pt-0">
          <button type="button" onClick={onBack} aria-label="Volver a los chats" className="mr-2 flex h-11 w-11 items-center justify-center rounded-full text-signal-ink active:bg-border-soft md:hidden">
            <ChevronLeft className="h-7 w-7" strokeWidth={2.4} />
          </button>
          <div className="h-4 w-40 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
        </div>
        <div className="flex-1 space-y-4 p-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex gap-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-stone-100 dark:bg-night-700" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-32 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (query.error || !data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-14 items-center border-b border-stone px-2 pt-[env(safe-area-inset-top)] dark:border-night-700 md:hidden">
          <button type="button" onClick={onBack} aria-label="Volver a los chats" className="flex h-11 w-11 items-center justify-center rounded-full text-signal-ink active:bg-border-soft">
            <ChevronLeft className="h-7 w-7" strokeWidth={2.4} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            title="No se pudo abrir el canal"
            description={query.error?.message ?? 'Intenta de nuevo en unos segundos.'}
            action={<Button variant="outline" size="sm" onClick={() => void query.refetch()}>Reintentar</Button>}
          />
        </div>
      </div>
    )
  }

  const isDm = data.channel.kind === 'dm'
  const title = channel?.name ?? data.channel.name
  const muted = channel?.muted ?? false
  const memberCount = members.data?.length
  // General and the automatic empresa/capa channels are re-joined by chat.bootstrap, so leaving them would not stick.
  const slug = channel?.slug ?? ''
  const canLeave = isMember && !isDm && slug !== 'general' && !slug.startsWith('empresa-') && !slug.startsWith('capa-')

  const subtitle = isDm ? 'Mensaje directo' : memberCount !== undefined ? `${memberCount} ${memberCount === 1 ? 'miembro' : 'miembros'}` : (data.channel.description ?? '')

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background md:bg-surface">
      {/* ── Phone header: iOS-style compact bar ── */}
      <header className="shrink-0 border-b border-border bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden">
        <div className="flex h-[52px] items-center gap-0.5 px-1">
          <button type="button" onClick={onBack} aria-label="Volver a los chats" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-border-soft">
            <ChevronLeft className="h-7 w-7 text-signal-ink" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="Información del chat"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1 text-left active:bg-border-soft"
          >
            {isDm && channel?.peer ? (
              <UserAvatar name={channel.peer.name} src={channel.peer.avatarUrl} className="h-9 w-9 text-xs" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-night text-signal dark:bg-border-soft">
                {data.channel.visibility === 'private' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-display text-[16px] font-extrabold leading-tight tracking-[-0.02em] text-foreground">{title}</span>
              {subtitle && <span className="block truncate text-[12px] leading-tight text-graphite">{subtitle}</span>}
            </span>
          </button>
          {isMember && (
            <button
              type="button"
              onClick={() => runSummary('unread')}
              disabled={summarize.isPending}
              aria-label="¿Qué me perdí?"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-border-soft disabled:opacity-60"
            >
              {summarize.isPending ? <Loader2 className="h-5 w-5 animate-spin text-signal-ink" /> : <Sparkles className="h-5 w-5 text-signal-ink" />}
            </button>
          )}
          <button type="button" onClick={() => setInfoOpen(true)} aria-label="Más opciones" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-border-soft">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </header>
      <ChannelInfoSheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        channelId={channelId}
        title={title}
        description={isDm ? undefined : data.channel.description}
        isDm={isDm}
        members={members.data ?? []}
        membersLoading={members.isLoading}
        meId={me?.user.id}
        isMember={isMember}
        muted={muted}
        onToggleMute={() => setMuted.mutate({ channelId, muted: !muted })}
        onSummarize={runSummary}
        summarizing={summarize.isPending}
        canLeave={canLeave}
        onLeave={handleLeave}
      />

      {/* ── Desktop header ── */}
      <header className="hidden min-h-14 items-center gap-1 border-b border-stone px-4 py-2 dark:border-night-700 md:flex">

        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
          {isDm && channel?.peer ? (
            <UserAvatar name={channel.peer.name} src={channel.peer.avatarUrl} className="h-8 w-8" />
          ) : data.channel.visibility === 'private' ? (
            <Lock className="h-4 w-4 shrink-0 text-graphite" aria-label="Canal privado" />
          ) : (
            <Hash className="h-4 w-4 shrink-0 text-graphite" aria-label="Canal público" />
          )}
          <div className="min-w-0">
            <h2 className="truncate font-display text-[15px] font-bold leading-tight tracking-[-0.01em] text-night dark:text-mist">{title}</h2>
            {data.channel.description && !isDm && <p className="truncate text-xs text-graphite">{data.channel.description}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isMember && (
            <button
              type="button"
              onClick={() => runSummary('unread')}
              disabled={summarize.isPending}
              aria-busy={summarize.isPending}
              title="¿Qué me perdí?"
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-signal px-3 text-xs font-semibold text-night transition-colors hover:bg-[#F0A30F] disabled:cursor-wait disabled:opacity-70 md:h-8"
            >
              {summarize.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{summarize.isPending ? 'Leyendo…' : '¿Qué me perdí?'}</span>
            </button>
          )}
          <ExtractTasksButton channelId={channelId} />

          <div className="relative">
            <button
              type="button"
              onClick={() => setMembersOpen(o => !o)}
              aria-expanded={membersOpen}
              aria-label={`Miembros${memberCount !== undefined ? ` (${memberCount})` : ''}`}
              title="Miembros"
              className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-graphite hover:bg-stone-100 hover:text-night dark:hover:bg-night-700 dark:hover:text-mist md:h-8"
            >
              <Users className="h-4 w-4" />
              {memberCount !== undefined && <span className="tabular-nums">{memberCount}</span>}
            </button>
            <Popover open={membersOpen} onClose={() => setMembersOpen(false)} align="right" label="Miembros del canal" className="max-h-72 w-64 overflow-y-auto">
              {members.isLoading ? (
                <p className="px-3 py-3 text-sm text-graphite">Cargando…</p>
              ) : (members.data ?? []).length === 0 ? (
                <p className="px-3 py-3 text-sm text-graphite">Sin miembros.</p>
              ) : (
                <ul>
                  {(members.data ?? []).map(m => (
                    <li key={m.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                      <UserAvatar name={m.name} src={m.avatarUrl} className="h-6 w-6" />
                      <span className="min-w-0 flex-1 truncate text-sm text-night dark:text-mist">{m.name}{m.id === me?.user.id ? ' (tú)' : ''}</span>
                      {m.role === 'admin' && <span className="text-[10px] font-semibold uppercase text-graphite">admin</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Popover>
          </div>

          {isMember && (
            <button
              type="button"
              onClick={() => setMuted.mutate({ channelId, muted: !muted })}
              aria-pressed={muted}
              aria-label={muted ? 'Activar avisos' : 'Silenciar canal'}
              title={muted ? 'Activar avisos' : 'Silenciar canal'}
              className="flex h-10 w-10 items-center justify-center rounded-md text-graphite hover:bg-stone-100 hover:text-night dark:hover:bg-night-700 dark:hover:text-mist md:h-8 md:w-8"
            >
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </button>
          )}
          {canLeave && (
            <button
              type="button"
              onClick={handleLeave}
              aria-label="Salir del canal"
              title="Salir del canal"
              className="flex h-10 w-10 items-center justify-center rounded-md text-graphite hover:bg-danger-wash hover:text-danger md:h-8 md:w-8"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {summary && (
        <section className="relative border-b border-signal/30 bg-signal-wash px-4 py-3 dark:bg-signal/10" aria-label="Resumen de Faro" data-no-ptr>
          <button
            type="button"
            onClick={() => setSummary(null)}
            aria-label="Cerrar resumen"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-graphite hover:bg-signal/20 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="mb-1 flex items-center gap-1.5 pr-8 text-xs font-semibold text-signal-ink dark:text-signal">
            <Sparkles className="h-3.5 w-3.5" />
            {summary.mode === 'unread' ? 'Lo que te perdiste' : 'Resumen de los últimos mensajes'}
            {summary.count > 0 && <span className="font-normal text-graphite">· {summary.count} mensajes</span>}
          </p>
          <div className="max-h-56 overflow-y-auto pr-2">
            <RichText body={summary.text} />
          </div>
          {summary.mode === 'unread' && (
            <button
              type="button"
              onClick={() => runSummary('recent')}
              disabled={summarize.isPending}
              className="mt-2 text-xs font-medium text-signal-ink underline underline-offset-2 disabled:opacity-60 dark:text-signal"
            >
              {summarize.isPending ? 'Resumiendo…' : 'Resumir últimos mensajes'}
            </button>
          )}
        </section>
      )}

      {data.messages.length === 0 && sendApi.pending.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            icon={isDm ? Users : Hash}
            title={isDm ? `Empieza la conversación con ${title}` : `Aquí empieza #${title}`}
            description={isMember ? 'Escribe el primer mensaje. Usa @ para mencionar a alguien y @faro para preguntarle a Faro.' : 'Aún no hay mensajes en este canal.'}
            py={8}
          />
        </div>
      ) : (
        <MessageList
          channelId={channelId}
          latest={data.messages}
          hasMoreLatest={data.hasMore}
          lastReadAt={data.lastReadAt}
          pending={sendApi.pending}
          onRetry={sendApi.retry}
          onDiscard={sendApi.discard}
          highlightMessageId={highlightMessageId}
          onHighlightDone={onHighlightDone}
          onOpenThread={onOpenThread}
          channelWorkspaceId={channel?.workspaceId ?? null}
          askingFaro={sendApi.askingFaro}
          meId={me?.user.id}
        />
      )}

      {isMember ? (
        <Composer send={sendApi} draftKey={`c:${channelId}`} placeholder={isDm ? `Mensaje para ${title}` : `Mensaje en #${title}`} autoFocus />
      ) : (
        <div className={cn('flex items-center justify-between gap-3 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3')}>
          <p className="text-sm text-graphite">Estás viendo este canal sin ser miembro.</p>
          <Button variant="signal" size="sm" onClick={() => join.mutate({ channelId })} disabled={join.isPending}>
            {join.isPending ? 'Uniéndote…' : 'Unirme'}
          </Button>
        </div>
      )}
    </div>
  )
}
