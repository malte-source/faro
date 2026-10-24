'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import {
  classifySendError,
  dueItems,
  inFlightIds,
  markInFlight,
  nextWakeAt,
  outboxAdd,
  outboxList,
  outboxMarkFatal,
  outboxMarkRetry,
  outboxRemove,
  outboxRetryNow,
  subscribeOutbox,
  unmarkInFlight,
  type OutboxItem,
  type OutboxKind,
} from '@/lib/outbox'
import { deliverItem, type CaptureClient } from './outbox-delivery'

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Reactive view of the outbox (updates on any change, in this tab or another). */
export function useOutboxItems(): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([])
  useEffect(() => {
    let alive = true
    const load = () => { void outboxList().then(list => { if (alive) setItems(list) }) }
    load()
    const off = subscribeOutbox(load)
    return () => { alive = false; off() }
  }, [])
  return items
}

// ── Flusher ─────────────────────────────────────────────────────────────────

let flushing = false
let requestFlush: (() => void) | null = null

/**
 * Deliver everything that is due. Single-flight across the whole app (the chip,
 * the mobile FAB and the capture screen may all mount a flusher). Offline: wait,
 * without burning attempts. A refusal retrying can't fix stays in the list as
 * "No se pudo enviar", for a manual retry or discard.
 */
export async function flushOutbox(client: CaptureClient, onDelivered?: () => void): Promise<void> {
  if (flushing || isOffline()) return
  flushing = true
  let delivered = 0
  try {
    const due = dueItems(await outboxList(), Date.now(), inFlightIds())
    for (const item of due) {
      if (isOffline()) break
      markInFlight(item.clientId)
      try {
        await deliverItem(client, item)
        await outboxRemove(item.clientId)
        delivered++
      } catch (err) {
        if (classifySendError(err) === 'fatal') await outboxMarkFatal(item.clientId, err)
        else await outboxMarkRetry(item.clientId, err, { offline: isOffline() })
      } finally {
        unmarkInFlight(item.clientId)
      }
    }
  } finally {
    flushing = false
  }
  if (delivered > 0) {
    toast.success(
      delivered === 1 ? 'Captura enviada' : `${delivered} capturas enviadas`,
      'Faro ya las leyó: revisa las tareas propuestas en Capturar.',
    )
    onDelivered?.()
  }
}

/** Ask the mounted flusher to run soon (e.g. right after something was queued while the page is hidden). */
export function kickFlush() {
  requestFlush?.()
}

/**
 * Keep the outbox moving. Runs on mount (app start), when the connection comes
 * back, when the app returns to the foreground, every 60 s as a safety net, and
 * exactly when the next backoff expires. Mount it once near the root of the
 * signed-in app (the chip and the mobile capture button also mount it).
 */
export function useOutboxFlusher() {
  const utils = trpc.useUtils()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let alive = true

    const schedule = async () => {
      if (timer) clearTimeout(timer)
      timer = null
      const wake = nextWakeAt(await outboxList())
      if (!alive || wake === null) return
      timer = setTimeout(() => { void run() }, Math.max(1_000, wake - Date.now()))
    }
    const run = async () => {
      await flushOutbox(utils.client, () => { void utils.capture.invalidate() })
      if (alive) await schedule()
    }
    const mine = () => { void run() }
    requestFlush = mine

    const onVisible = () => { if (document.visibilityState === 'visible') void run() }
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => { void run() }, 60_000)
    const off = subscribeOutbox(() => { void schedule() })
    void run()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
      off()
      if (requestFlush === mine) requestFlush = null
    }
  }, [utils])
}

/**
 * Save media to the outbox WITHOUT trying to send it now — for moments when the
 * page is going away (recording interrupted by a call, the app backgrounded).
 * The flusher delivers it as soon as the app is back in front.
 */
export async function enqueueMedia(
  blob: Blob,
  kind: Exclude<OutboxKind, 'text'>,
  opts: { durationSec?: number } = {},
): Promise<string> {
  const item = await outboxAdd({ kind, blob, mime: blob.type, durationSec: opts.durationSec })
  kickFlush()
  return item.clientId
}

export { outboxRemove, outboxRetryNow }
