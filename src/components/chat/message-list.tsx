'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Loader2, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { dayKey, dayLabel } from '@/components/chat/chat-utils'
import { MessageItem, PendingItem } from '@/components/chat/message-item'
import type { ChatMessage, PendingMessage } from '@/components/chat/types'

type Row =
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'msg'; key: string; message: ChatMessage; grouped: boolean }

const GROUP_WINDOW_MS = 5 * 60_000
const NEAR_BOTTOM_PX = 120

interface OlderState {
  channelId: string
  messages: ChatMessage[]
  hasMore: boolean | null
}

/**
 * Scrollable message list of a channel: older pages on demand, day
 * separators, "Nuevos mensajes" divider, grouping of consecutive messages,
 * smart autoscroll (only when the user was already at the bottom) and
 * deep-link highlight.
 */
export function MessageList({
  channelId,
  latest,
  hasMoreLatest,
  lastReadAt,
  pending,
  onRetry,
  onDiscard,
  highlightMessageId,
  onHighlightDone,
  onOpenThread,
  channelWorkspaceId,
  askingFaro,
  meId,
}: {
  channelId: string
  latest: ChatMessage[]
  hasMoreLatest: boolean
  lastReadAt: string | null
  pending: PendingMessage[]
  onRetry: (tempId: string) => void
  onDiscard: (tempId: string) => void
  highlightMessageId: string | null
  onHighlightDone: () => void
  onOpenThread: (messageId: string) => void
  channelWorkspaceId: string | null
  askingFaro: boolean
  meId: string | undefined
}) {
  const utils = trpc.useUtils()
  const containerRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const scrolledFor = useRef<string | null>(null)
  const restoreFrom = useRef<number | null>(null)
  const highlightTries = useRef(0)

  const [older, setOlder] = useState<OlderState>({ channelId, messages: [], hasMore: null })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [seenLastId, setSeenLastId] = useState<string | null>(null)
  const [initialRead, setInitialRead] = useState<{ channelId: string; at: string | null } | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // Per-channel state resets, derived during render (no effect needed).
  if (older.channelId !== channelId) setOlder({ channelId, messages: [], hasMore: null })
  if (initialRead?.channelId !== channelId) setInitialRead({ channelId, at: lastReadAt })

  const all = useMemo(() => {
    const seen = new Set<string>()
    const merged: ChatMessage[] = []
    for (const m of [...older.messages, ...latest]) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push(m)
    }
    return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [older.messages, latest])

  const hasMoreOlder = older.hasMore ?? hasMoreLatest
  const lastId = all.length ? all[all.length - 1].id : null

  const loadOlder = useCallback(async () => {
    if (loadingOlder || all.length === 0) return
    setLoadingOlder(true)
    try {
      const page = await utils.chat.messages.fetch({ channelId, before: all[0].createdAt }, { staleTime: 0 })
      if (containerRef.current) restoreFrom.current = containerRef.current.scrollHeight
      setOlder(prev => ({
        channelId,
        messages: [...page.messages, ...(prev.channelId === channelId ? prev.messages : [])],
        hasMore: page.hasMore,
      }))
    } catch (err) {
      toast.error('No se pudieron cargar los mensajes anteriores', err instanceof Error ? err.message : undefined)
    } finally {
      setLoadingOlder(false)
    }
  }, [all, channelId, loadingOlder, utils])

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Keep the viewport still after prepending older messages; jump to the
  // bottom on the first render of a channel; follow new messages only when the
  // user was already reading the latest ones.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (restoreFrom.current !== null) {
      el.scrollTop += el.scrollHeight - restoreFrom.current
      restoreFrom.current = null
      return
    }
    if (scrolledFor.current !== channelId) {
      if (all.length === 0 && highlightMessageId === null) return
      scrolledFor.current = channelId
      highlightTries.current = 0
      if (!highlightMessageId) el.scrollTop = el.scrollHeight
      return
    }
    if (nearBottom.current) el.scrollTop = el.scrollHeight
  }, [channelId, all.length, lastId, pending.length, askingFaro, highlightMessageId])

  // My own just-sent message always pulls the view to the bottom.
  useLayoutEffect(() => {
    if (pending.length > 0) {
      nearBottom.current = true
      const el = containerRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [pending.length])

  // Deep link: bring the message into view (loading older pages if needed), flash it, then clear the param.
  useEffect(() => {
    if (!highlightMessageId) return
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-msg-id="${highlightMessageId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      nearBottom.current = false
      setHighlightedId(highlightMessageId)
      const timer = window.setTimeout(() => { setHighlightedId(null); onHighlightDone() }, 2500)
      return () => window.clearTimeout(timer)
    }
    if (all.length > 0 && hasMoreOlder && highlightTries.current < 6 && !loadingOlder) {
      highlightTries.current++
      void loadOlder()
    } else if (all.length > 0 && !hasMoreOlder) {
      onHighlightDone()
    }
  }, [highlightMessageId, all.length, hasMoreOlder, loadingOlder, loadOlder, onHighlightDone])

  const onScroll = () => {
    const el = containerRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    nearBottom.current = near
    if (near) setSeenLastId(prev => (prev === lastId ? prev : lastId))
  }

  // First paint of a channel counts everything as seen.
  if (seenLastId === null && lastId !== null) setSeenLastId(lastId)

  const unseen = useMemo(() => {
    if (!seenLastId) return 0
    const idx = all.findIndex(m => m.id === seenLastId)
    if (idx < 0) return 0
    return all.slice(idx + 1).filter(m => m.author?.id !== meId && m.kind !== 'system').length
  }, [all, seenLastId, meId])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const readAt = initialRead?.channelId === channelId ? initialRead.at : null
    let dividerPlaced = false
    let prev: ChatMessage | null = null
    for (const m of all) {
      const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
      if (newDay) out.push({ type: 'day', key: `day-${dayKey(m.createdAt)}`, label: dayLabel(m.createdAt) })
      let dividerBefore = false
      if (!dividerPlaced && readAt && m.createdAt > readAt && m.author?.id !== meId && m.kind !== 'system') {
        out.push({ type: 'unread', key: 'unread' })
        dividerPlaced = true
        dividerBefore = true
      }
      const grouped =
        !!prev && !newDay && !dividerBefore &&
        m.kind === 'text' && prev.kind === 'text' &&
        !!m.author && m.author.id === prev.author?.id &&
        new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
      out.push({ type: 'msg', key: m.id, message: m, grouped })
      prev = m
    }
    return out
  }, [all, initialRead, channelId, meId])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain py-2 pb-3"
        data-no-track
        data-no-ptr
        role="log"
        aria-live="polite"
        aria-label="Mensajes"
      >
        {hasMoreOlder && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-border bg-surface px-4 text-xs font-medium text-graphite hover:border-graphite hover:text-foreground disabled:opacity-60"
            >
              {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
              Cargar anteriores
            </button>
          </div>
        )}

        {rows.map(row => {
          if (row.type === 'day') {
            return (
              <div key={row.key} className="flex items-center justify-center gap-3 px-4 py-3 md:justify-start" role="separator" aria-label={row.label}>
                <span className="hidden h-px flex-1 bg-stone dark:bg-night-700 md:block" />
                <span className="rounded-full bg-border-soft px-3 py-0.5 text-[11px] font-semibold capitalize text-graphite md:bg-transparent md:px-0 md:py-0">{row.label}</span>
                <span className="hidden h-px flex-1 bg-stone dark:bg-night-700 md:block" />
              </div>
            )
          }
          if (row.type === 'unread') {
            return (
              <div key={row.key} className="flex items-center gap-3 px-4 py-2" role="separator" aria-label="Nuevos mensajes">
                <span className="h-px flex-1 bg-danger/50" />
                <span className="rounded-full bg-danger-wash px-2.5 py-0.5 text-[11px] font-semibold text-danger dark:bg-danger/15 md:bg-transparent md:px-0 md:py-0">Nuevos mensajes</span>
                <span className="h-px flex-1 bg-danger/50" />
              </div>
            )
          }
          return (
            <MessageItem
              key={row.key}
              message={row.message}
              variant="channel"
              grouped={row.grouped}
              highlighted={highlightedId === row.message.id}
              channelWorkspaceId={channelWorkspaceId}
              onOpenThread={onOpenThread}
            />
          )
        })}

        {pending.map(p => <PendingItem key={p.tempId} item={p} onRetry={onRetry} onDiscard={onDiscard} />)}

        {askingFaro && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs text-graphite" role="status">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-signal-ink dark:text-signal" />
            Faro está escribiendo…
          </div>
        )}
      </div>

      {unseen > 0 && (
        <button
          type="button"
          onClick={() => { nearBottom.current = true; scrollToBottom(true) }}
          className={cn(
            'absolute bottom-3 left-1/2 flex min-h-[40px] -translate-x-1/2 items-center gap-1.5 rounded-full bg-night px-4 text-xs font-semibold text-mist shadow-lg',
            'hover:bg-night-700 focus-visible:ring-2 focus-visible:ring-signal dark:bg-signal dark:text-night dark:hover:bg-signal/90',
          )}
        >
          {unseen} {unseen === 1 ? 'mensaje nuevo' : 'mensajes nuevos'} <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
