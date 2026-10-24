'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { ChevronLeft, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Composer } from '@/components/chat/composer'
import { ExtractTasksButton } from '@/components/chat/extract-tasks-button'
import { useSendMessage, useThreadMessages, useVisualViewportBox } from '@/components/chat/hooks'
import { MessageItem, PendingItem } from '@/components/chat/message-item'

function ThreadBody({ channelId, parentId, channelWorkspaceId }: { channelId: string; parentId: string; channelWorkspaceId: string | null }) {
  const query = useThreadMessages(parentId)
  const sendApi = useSendMessage({ channelId, parentId })
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const replies = query.data?.replies ?? []
  const lastReplyId = replies.length ? replies[replies.length - 1].id : null

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight
  }, [lastReplyId, sendApi.pending.length, sendApi.askingFaro, query.isLoading])

  if (query.isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4">
        {[0, 1, 2].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />)}
      </div>
    )
  }
  if (query.error || !query.data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          title="No se pudo abrir el hilo"
          description={query.error?.message ?? 'Intenta de nuevo.'}
          action={<Button variant="outline" size="sm" onClick={() => void query.refetch()}>Reintentar</Button>}
          py={6}
        />
      </div>
    )
  }

  const { root } = query.data
  return (
    <>
      <div
        ref={scroller}
        onScroll={e => {
          const el = e.currentTarget
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2 pb-3"
        data-no-track
        data-no-ptr
        role="log"
        aria-live="polite"
        aria-label="Respuestas del hilo"
      >
        <MessageItem message={root} variant="root" channelWorkspaceId={channelWorkspaceId} />
        <div className="flex items-center gap-3 px-4 py-2" role="separator">
          <span className="text-[11px] font-semibold text-graphite">
            {replies.length === 0 ? 'Sin respuestas todavía' : `${replies.length} ${replies.length === 1 ? 'respuesta' : 'respuestas'}`}
          </span>
          <span className="h-px flex-1 bg-stone dark:bg-night-700" />
        </div>
        {replies.map(r => (
          <MessageItem key={r.id} message={r} variant="reply" channelWorkspaceId={channelWorkspaceId} />
        ))}
        {sendApi.pending.map(p => <PendingItem key={p.tempId} item={p} onRetry={sendApi.retry} onDiscard={sendApi.discard} />)}
        {sendApi.askingFaro && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs text-graphite" role="status">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-signal-ink dark:text-signal" />
            Faro está escribiendo…
          </div>
        )}
      </div>
      <Composer key={parentId} send={sendApi} draftKey={`t:${parentId}`} placeholder="Responder en el hilo" autoFocus />
    </>
  )
}

/**
 * Right-hand thread pane (desktop) / full-screen overlay (mobile). Closes with
 * the X button, the back arrow on mobile, or Escape.
 */
export function ThreadPanel({
  channelId,
  parentId,
  channelWorkspaceId,
  onClose,
}: {
  channelId: string
  parentId: string
  channelWorkspaceId: string | null
  onClose: () => void
}) {
  const panel = useRef<HTMLElement>(null)
  const box = useVisualViewportBox()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Let open dialogs/popups consume Escape first.
      if (document.querySelector('[role="dialog"]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      ref={panel}
      aria-label="Hilo"
      style={{ top: box.top, height: box.height }}
      className="fixed inset-x-0 top-0 z-[46] flex h-dvh flex-col bg-background md:static md:z-auto md:h-auto md:w-[380px] md:shrink-0 md:border-l md:border-stone md:bg-surface md:dark:border-night-700"
    >
      <header className="shrink-0 border-b border-border bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:min-h-14 md:border-stone md:bg-transparent md:pt-0 md:backdrop-blur-none dark:md:border-night-700">
      <div className="flex h-[52px] items-center gap-1 px-1 md:min-h-14 md:px-4 md:py-2">
        <button type="button" onClick={onClose} aria-label="Volver a la conversación" className="flex h-11 items-center gap-0.5 rounded-full pl-1 pr-3 text-[15px] font-medium text-foreground active:bg-border-soft md:hidden">
          <ChevronLeft className="h-7 w-7 text-signal-ink" strokeWidth={2.4} />
          Chat
        </button>
        <h3 className="flex-1 px-1 text-center font-display text-[16px] font-extrabold tracking-[-0.02em] text-foreground md:text-left md:text-[15px] md:font-bold md:tracking-[-0.01em]">Hilo</h3>
        <ExtractTasksButton channelId={channelId} parentId={parentId} />
        <button type="button" onClick={onClose} aria-label="Cerrar hilo" className="hidden h-8 w-8 items-center justify-center rounded-md text-graphite hover:bg-stone-100 hover:text-night md:flex dark:hover:bg-night-700 dark:hover:text-mist">
          <X className="h-4 w-4" />
        </button>
      </div>
      </header>
      <ThreadBody key={parentId} channelId={channelId} parentId={parentId} channelWorkspaceId={channelWorkspaceId} />
    </aside>
  )
}
