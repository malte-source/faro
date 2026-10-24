'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { CheckSquare, Copy, MessageSquareReply, Pencil, RotateCw, SmilePlus, Trash2, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { FaroMarkSmall } from '@/components/brand/logo'
import { useIsMobile } from '@/components/mobile/use-media'
import { haptic } from '@/components/mobile/haptics'
import { QUICK_EMOJIS, relativeTime, timeLabel } from '@/components/chat/chat-utils'
import { RichText } from '@/components/chat/rich-text'
import { Popover } from '@/components/chat/popover'
import { UserAvatar } from '@/components/chat/user-avatar'
import { TaskDialog } from '@/components/chat/dialogs'
import { MessageActionSheet } from '@/components/chat/mobile-chat-sheets'
import { useChatDirectory, useLongPress, useMe } from '@/components/chat/hooks'
import type { ChatMessage, PendingMessage } from '@/components/chat/types'

type Variant = 'channel' | 'root' | 'reply'

function ActionButton({
  label,
  onClick,
  children,
  danger = false,
  pressed,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-md text-graphite transition-colors md:h-7 md:w-7',
        danger ? 'hover:bg-danger-wash hover:text-danger' : 'hover:bg-stone-100 hover:text-night dark:hover:bg-night-700 dark:hover:text-mist',
      )}
    >
      {children}
    </button>
  )
}

/**
 * One message. Self-contained: reactions, edit, delete, thread and
 * "convertir en tarea" all go through trpc.chat directly, so channel and
 * thread views just render it.
 *
 * Desktop: Slack-style rows with a hover toolbar. Phones: chat bubbles (mine on
 * the right in Señal, theirs on the left on a card) with a long-press action
 * sheet — hover toolbars don't exist on touch.
 */
export function MessageItem({
  message,
  variant,
  grouped = false,
  highlighted = false,
  channelWorkspaceId = null,
  onOpenThread,
}: {
  message: ChatMessage
  variant: Variant
  grouped?: boolean
  highlighted?: boolean
  channelWorkspaceId?: string | null
  onOpenThread?: (messageId: string) => void
}) {
  const me = useMe()
  const { byId } = useChatDirectory()
  const utils = trpc.useUtils()
  const isMobile = useIsMobile()
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [touchOpen, setTouchOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)
  const [taskOpen, setTaskOpen] = useState(false)

  const refresh = () => {
    void utils.chat.messages.invalidate({ channelId: message.channelId })
    void utils.chat.thread.invalidate()
    void utils.chat.channels.invalidate()
  }

  const react = trpc.chat.react.useMutation({ onSuccess: refresh, onError: err => toast.error('No se pudo reaccionar', err.message) })
  const remove = trpc.chat.remove.useMutation({ onSuccess: refresh, onError: err => toast.error('No se pudo borrar', err.message) })
  const edit = trpc.chat.edit.useMutation({
    onSuccess: () => { setEditing(false); refresh() },
    onError: err => toast.error('No se pudo editar', err.message),
  })

  const mentionNames = useMemo(
    () => message.mentions.map(id => byId.get(id)?.name).filter((n): n is string => !!n),
    [message.mentions, byId],
  )

  const longPress = useLongPress(() => {
    if (message.deleted || editing || message.kind === 'system') return
    haptic()
    setSheetOpen(true)
  })

  // On touch screens (no hover) tapping a message reveals its toolbar (desktop-width touch devices).
  const toggleTouch = () => {
    if (!isMobile && window.matchMedia('(hover: none)').matches) setTouchOpen(o => !o)
  }

  const canModerate = !!me?.isDirection
  const authorName = message.author?.name ?? 'Alguien'

  if (message.kind === 'system') {
    return (
      <div data-msg-id={message.id} className="px-4 py-1.5 text-center text-xs text-graphite">
        <span className="inline-block max-w-full rounded-full bg-border-soft px-3 py-1 md:bg-transparent md:px-0 md:py-0">{message.body}</span>
      </div>
    )
  }

  const isAi = message.kind === 'ai'
  const canReply = variant === 'channel'
  const canTask = !message.deleted && !message.task
  const bubble = isMobile && !isAi
  const mine = message.mine

  const onToggleEmoji = (emoji: string) => {
    setEmojiOpen(false)
    react.mutate({ messageId: message.id, emoji })
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.body)
      toast.success('Texto copiado')
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const handleDelete = async () => {
    const ok = await confirmAction({
      title: 'Borrar mensaje',
      description: 'Se borra para todos y no se puede deshacer.',
      confirmLabel: 'Borrar',
      variant: 'destructive',
    })
    if (ok) remove.mutate({ messageId: message.id })
  }

  const saveEdit = () => {
    const body = draft.trim()
    if (!body || body === message.body) { setEditing(false); return }
    edit.mutate({ messageId: message.id, body })
  }

  const content = (
    <>
      {message.deleted ? (
        <p className="text-sm italic text-graphite">Mensaje eliminado</p>
      ) : editing ? (
        <div className="space-y-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            aria-label="Editar mensaje"
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); setDraft(message.body) }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit() }
            }}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            className="w-full resize-none rounded-[10px] border border-night bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-signal/40 dark:border-signal dark:bg-[#12293A]"
          />
          <p className="flex items-center gap-3 text-[11px] text-graphite">
            <span className="hidden md:inline">Enter guarda · Esc cancela</span>
            <button type="button" onClick={saveEdit} disabled={edit.isPending} className="min-h-[32px] font-semibold text-signal-ink underline underline-offset-2 dark:text-signal">Guardar</button>
            <button type="button" onClick={() => { setEditing(false); setDraft(message.body) }} className="min-h-[32px] md:hidden">Cancelar</button>
          </p>
        </div>
      ) : (
        <RichText body={message.body} mentionNames={mentionNames} inherit={bubble} onAccent={bubble && mine} />
      )}
    </>
  )

  const extras = (
    <>
      {!message.deleted && message.task && (
        <span className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-success/30 bg-success-wash px-2.5 py-0.5 text-xs font-medium text-success">
          <CheckSquare className="h-3 w-3 shrink-0" />
          <span className="truncate">Tarea: {message.task.title}</span>
        </span>
      )}

      {!message.deleted && message.reactions.length > 0 && (
        <div className={cn('mt-1.5 flex flex-wrap gap-1', bubble && mine && 'justify-end')} role="group" aria-label="Reacciones">
          {message.reactions.map(r => (
            <button
              key={r.emoji}
              type="button"
              aria-pressed={r.mine}
              aria-label={`${r.emoji} ${r.count}`}
              onClick={() => { haptic(); react.mutate({ messageId: message.id, emoji: r.emoji }) }}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors active:scale-95 md:h-6 md:px-2',
                r.mine
                  ? 'border-signal bg-signal/20 text-foreground dark:text-signal'
                  : 'border-border bg-surface text-graphite hover:border-graphite',
              )}
            >
              <span>{r.emoji}</span>
              <span className="tabular-nums">{r.count}</span>
            </button>
          ))}
        </div>
      )}

      {canReply && message.replyCount > 0 && onOpenThread && (
        <button
          type="button"
          onClick={() => onOpenThread(message.id)}
          className="mt-1.5 flex min-h-[36px] items-center gap-2 rounded-lg px-1.5 py-0.5 text-xs font-semibold text-signal-ink active:bg-signal-wash hover:bg-signal-wash dark:text-signal dark:hover:bg-signal/10 md:min-h-[32px] md:font-medium"
        >
          <span className="flex -space-x-1.5">
            {message.replyAuthors.map(a => <UserAvatar key={a.id} name={a.name} src={a.avatarUrl} className="h-4 w-4 ring-1 ring-surface" />)}
          </span>
          {message.replyCount} {message.replyCount === 1 ? 'respuesta' : 'respuestas'}
          {message.lastReplyAt && <span className="font-normal text-graphite">· {relativeTime(message.lastReplyAt)}</span>}
        </button>
      )}
    </>
  )

  const body = <>{content}{extras}</>

  const toolbar = !message.deleted && !editing && !isMobile && (
    <div
      className={cn(
        'absolute -top-4 right-3 z-10 items-center gap-0.5 rounded-lg border border-stone bg-surface p-0.5 shadow-sm dark:border-[#1E3A4C] dark:bg-[#12293A]',
        touchOpen ? 'flex' : 'hidden group-hover:flex group-focus-within:flex',
      )}
      role="toolbar"
      aria-label="Acciones del mensaje"
    >
      <div className="relative">
        <ActionButton label="Reaccionar" onClick={() => setEmojiOpen(o => !o)} pressed={emojiOpen}>
          <SmilePlus className="h-4 w-4" />
        </ActionButton>
        <Popover open={emojiOpen} onClose={() => setEmojiOpen(false)} align="right" label="Elegir reacción" className="flex gap-0.5 whitespace-nowrap">
          {QUICK_EMOJIS.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => onToggleEmoji(e)}
              aria-label={`Reaccionar con ${e}`}
              className="flex h-10 w-10 items-center justify-center rounded-md text-lg hover:bg-stone-100 dark:hover:bg-night-700 md:h-8 md:w-8"
            >
              {e}
            </button>
          ))}
        </Popover>
      </div>
      {canReply && onOpenThread && (
        <ActionButton label="Responder en hilo" onClick={() => onOpenThread(message.id)}>
          <MessageSquareReply className="h-4 w-4" />
        </ActionButton>
      )}
      {canTask && (
        <ActionButton label="Convertir en tarea" onClick={() => setTaskOpen(true)}>
          <CheckSquare className="h-4 w-4" />
        </ActionButton>
      )}
      <ActionButton label="Copiar texto" onClick={handleCopy}>
        <Copy className="h-4 w-4" />
      </ActionButton>
      {message.mine && !isAi && (
        <ActionButton label="Editar" onClick={() => { setDraft(message.body); setEditing(true) }}>
          <Pencil className="h-4 w-4" />
        </ActionButton>
      )}
      {(message.mine || canModerate) && (
        <ActionButton label="Borrar" onClick={handleDelete} danger>
          <Trash2 className="h-4 w-4" />
        </ActionButton>
      )}
    </div>
  )

  const dialogs = (
    <>
      {taskOpen && <TaskDialog message={message} channelWorkspaceId={channelWorkspaceId} onClose={() => setTaskOpen(false)} />}
      {isMobile && !message.deleted && (
        <MessageActionSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          mineReactions={new Set(message.reactions.filter(r => r.mine).map(r => r.emoji))}
          onReact={emoji => react.mutate({ messageId: message.id, emoji })}
          onReply={canReply && onOpenThread ? () => onOpenThread(message.id) : undefined}
          onTask={canTask ? () => setTaskOpen(true) : undefined}
          onCopy={handleCopy}
          onEdit={message.mine && !isAi ? () => { setDraft(message.body); setEditing(true) } : undefined}
          onDelete={message.mine || canModerate ? handleDelete : undefined}
        />
      )}
    </>
  )

  if (isAi) {
    return (
      <div
        data-msg-id={message.id}
        onClick={toggleTouch}
        {...longPress}
        className={cn('group relative px-3 py-1.5 md:px-4', highlighted && 'bg-signal/15')}
      >
        <div className="flex gap-3 rounded-[18px] border border-signal/30 bg-signal-wash p-3 dark:bg-signal/10 md:rounded-xl">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-night">
            <FaroMarkSmall size={18} plain />
          </span>
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 flex items-baseline gap-2 text-sm font-semibold text-foreground">
              Faro <span className="text-[11px] font-normal text-graphite">{timeLabel(message.createdAt)}</span>
            </p>
            {body}
          </div>
        </div>
        {toolbar}
        {dialogs}
      </div>
    )
  }

  if (bubble) {
    return (
      <div
        data-msg-id={message.id}
        {...longPress}
        className={cn(
          'flex items-end gap-2 px-3 [-webkit-touch-callout:none]',
          grouped ? 'pt-0.5' : 'pt-2.5',
          mine ? 'justify-end' : 'justify-start',
          highlighted && 'bg-signal/15',
        )}
      >
        {!mine && (grouped
          ? <span className="w-8 shrink-0" aria-hidden />
          : <UserAvatar name={authorName} src={message.author?.avatarUrl} className="h-8 w-8 shrink-0 text-[10px]" />)}
        <div className={cn('flex min-w-0 max-w-[82%] flex-col', mine ? 'items-end' : 'items-start')}>
          {!mine && !grouped && <span className="mb-0.5 px-1 text-[12px] font-semibold text-graphite">{authorName}</span>}
          <div
            className={cn(
              'select-none rounded-[20px] px-3.5 py-2',
              mine ? 'rounded-br-[6px] bg-signal text-night' : 'rounded-bl-[6px] border border-border bg-surface text-foreground',
              message.mentionsMe && !mine && !message.deleted && 'ring-2 ring-signal/70',
              message.deleted && 'bg-border-soft',
            )}
          >
            {content}
            {!message.deleted && !editing && (
              <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums', mine ? 'text-night/60' : 'text-graphite')}>
                {message.edited && <span>editado</span>}
                {timeLabel(message.createdAt)}
              </p>
            )}
          </div>
          <div className={cn('flex max-w-full flex-col', mine ? 'items-end' : 'items-start')}>{extras}</div>
        </div>
        {dialogs}
      </div>
    )
  }

  return (
    <div
      data-msg-id={message.id}
      onClick={toggleTouch}
      className={cn(
        'group relative flex gap-3 px-4 transition-colors hover:bg-stone-100/60 dark:hover:bg-night-700/40',
        grouped ? 'py-0.5' : 'pt-2 pb-0.5',
        message.mentionsMe && !message.deleted && 'bg-signal-wash hover:bg-signal-wash dark:bg-signal/10 dark:hover:bg-signal/10',
        highlighted && 'bg-signal/20 ring-1 ring-inset ring-signal',
      )}
    >
      {grouped ? (
        <span className="w-8 shrink-0 pt-1 text-right text-[10px] text-transparent group-hover:text-graphite">{timeLabel(message.createdAt)}</span>
      ) : (
        <UserAvatar name={authorName} src={message.author?.avatarUrl} className="mt-0.5" />
      )}
      <div className="min-w-0 flex-1 pb-1">
        {!grouped && (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">{authorName}</span>
            <span className="text-[11px] text-graphite">{timeLabel(message.createdAt)}</span>
            {message.edited && !message.deleted && <span className="text-[11px] text-graphite">(editado)</span>}
          </p>
        )}
        {grouped && message.edited && !message.deleted && <span className="float-right text-[11px] text-graphite">(editado)</span>}
        {body}
      </div>
      {toolbar}
      {dialogs}
    </div>
  )
}

/** A message the user just wrote and the server hasn't confirmed (or failed to). */
export function PendingItem({
  item,
  onRetry,
  onDiscard,
}: {
  item: PendingMessage
  onRetry: (tempId: string) => void
  onDiscard: (tempId: string) => void
}) {
  const me = useMe()
  const isMobile = useIsMobile()
  const name = me?.user.name ?? 'Tú'
  const failed = item.status === 'failed'

  const failure = failed && (
    <p className={cn('mt-1 flex flex-wrap items-center gap-3 text-xs text-danger', isMobile && 'justify-end')}>
      <span>{item.error ?? 'No se pudo enviar.'}</span>
      <button type="button" onClick={() => onRetry(item.tempId)} className="inline-flex min-h-[36px] items-center gap-1 font-medium underline underline-offset-2">
        <RotateCw className="h-3 w-3" /> Reintentar
      </button>
      <button type="button" onClick={() => onDiscard(item.tempId)} className="inline-flex min-h-[36px] items-center gap-1 font-medium text-graphite underline underline-offset-2">
        <X className="h-3 w-3" /> Descartar
      </button>
    </p>
  )

  if (isMobile) {
    return (
      <div className="flex flex-col items-end px-3 pt-2.5" role="status" aria-live="polite">
        <div className={cn('max-w-[82%] rounded-[20px] rounded-br-[6px] bg-signal px-3.5 py-2 text-night', !failed && 'opacity-60')}>
          <RichText body={item.body} inherit onAccent />
          <p className="mt-0.5 text-right text-[10px] text-night/60">{failed ? 'no se envió' : 'enviando…'}</p>
        </div>
        {failure}
      </div>
    )
  }

  return (
    <div className={cn('flex gap-3 px-4 pt-2 pb-1', !failed && 'opacity-60')} role="status" aria-live="polite">
      <UserAvatar name={name} src={me?.user.avatar} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <span className="text-[11px] text-graphite">{failed ? 'no se envió' : 'enviando…'}</span>
        </p>
        <RichText body={item.body} />
        {failure}
      </div>
    </div>
  )
}
