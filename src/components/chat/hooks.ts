'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import type { Directory, DirectoryPerson, PendingMessage } from '@/components/chat/types'

/** True while the tab is visible — polling pauses in background tabs. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    cb => {
      document.addEventListener('visibilitychange', cb)
      return () => document.removeEventListener('visibilitychange', cb)
    },
    () => document.visibilityState === 'visible',
    () => true,
  )
}

/** md breakpoint (768px) — decides between the single-pane (mobile) and three-pane (desktop) layout. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    cb => {
      const mq = window.matchMedia('(min-width: 768px)')
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia('(min-width: 768px)').matches,
    () => true,
  )
}

/** Directory of people and empresas the viewer can see, with an id → person map. */
export function useChatDirectory() {
  const query = trpc.membership.directory.useQuery(undefined, { staleTime: 60_000 })
  const byId = useMemo(() => {
    const map = new Map<string, DirectoryPerson>()
    for (const p of query.data?.people ?? []) map.set(p.id, p)
    return map
  }, [query.data])
  return { directory: query.data as Directory | undefined, byId, isLoading: query.isLoading }
}

export function useMe() {
  const { data } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  return data
}

const FARO_MENTION = /(^|\s)@faro\b/i

/**
 * Sending with optimistic rows. `pending` holds what the user just wrote
 * ('sending' → removed once the server confirms, 'failed' → retry/discard).
 * When the text mentions @faro, asks Faro right after the send succeeds and
 * exposes `askingFaro` for the "Faro está escribiendo…" indicator.
 */
export function useSendMessage({ channelId, parentId }: { channelId: string; parentId?: string }) {
  const utils = trpc.useUtils()
  const sendMutation = trpc.chat.send.useMutation()
  const askMutation = trpc.chat.askFaro.useMutation()
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [askingFaro, setAskingFaro] = useState(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const refresh = useCallback(() => {
    void utils.chat.messages.invalidate({ channelId })
    if (parentId) void utils.chat.thread.invalidate({ parentId })
    void utils.chat.channels.invalidate()
    void utils.chat.unreadTotal.invalidate()
  }, [utils, channelId, parentId])

  const deliver = useCallback(async (item: PendingMessage) => {
    setPending(list => list.map(p => (p.tempId === item.tempId ? { ...p, status: 'sending', error: undefined } : p)))
    try {
      await sendMutation.mutateAsync({ channelId, parentId, body: item.body, mentionIds: item.mentionIds })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo enviar.'
      if (alive.current) setPending(list => list.map(p => (p.tempId === item.tempId ? { ...p, status: 'failed', error: message } : p)))
      toast.error('No se pudo enviar el mensaje', message)
      return
    }
    if (alive.current) setPending(list => list.filter(p => p.tempId !== item.tempId))
    refresh()

    if (FARO_MENTION.test(item.body)) {
      const question = item.body.replace(/(^|\s)@faro\b/gi, ' ').replace(/\s+/g, ' ').trim() || 'Resume lo que se conversó y dime qué falta.'
      if (alive.current) setAskingFaro(n => n + 1)
      try {
        await askMutation.mutateAsync({ channelId, parentId, question })
      } catch (err) {
        toast.error('Faro no pudo responder', err instanceof Error ? err.message : undefined)
      } finally {
        if (alive.current) setAskingFaro(n => Math.max(0, n - 1))
        refresh()
      }
    }
  }, [sendMutation, askMutation, channelId, parentId, refresh])

  const send = useCallback((body: string, mentionIds: string[]) => {
    const item: PendingMessage = {
      tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      body,
      mentionIds,
      createdAt: new Date().toISOString(),
      status: 'sending',
    }
    setPending(list => [...list, item])
    void deliver(item)
  }, [deliver])

  const retry = useCallback((tempId: string) => {
    const item = pending.find(p => p.tempId === tempId)
    if (item) void deliver(item)
  }, [pending, deliver])

  const discard = useCallback((tempId: string) => {
    setPending(list => list.filter(p => p.tempId !== tempId))
  }, [])

  return { pending, send, retry, discard, askingFaro: askingFaro > 0 }
}

export type SendApi = ReturnType<typeof useSendMessage>

/**
 * Fit a full-screen phone surface (conversation, thread) to the *visual*
 * viewport. Android Chrome already resizes the layout viewport for the
 * keyboard (`interactiveWidget: resizes-content`); iOS Safari does not, so the
 * composer would hide behind it. Returns an inline style to put on the
 * `fixed inset-0` container; on desktop / without visualViewport it is empty.
 */
export function useVisualViewportBox(): { top?: number; height?: number } {
  const [box, setBox] = useState<{ top?: number; height?: number }>({})
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => {
      if (!mq.matches) { setBox(prev => (prev.height === undefined ? prev : {})); return }
      setBox({ top: Math.round(vv.offsetTop), height: Math.round(vv.height) })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    mq.addEventListener('change', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      mq.removeEventListener('change', update)
    }
  }, [])
  return box
}

/** Long-press (≈380 ms, cancelled by movement) for touch action sheets. Spread the result on the element. */
export function useLongPress(onLongPress: () => void, ms = 380) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = setTimeout(() => { fired.current = true; onLongPress() }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!origin.current) return
      if (Math.abs(e.clientX - origin.current.x) > 8 || Math.abs(e.clientY - origin.current.y) > 8) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => { if (fired.current || window.matchMedia('(hover: none)').matches) e.preventDefault() },
  }
}
