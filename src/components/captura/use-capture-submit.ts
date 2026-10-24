'use client'

import { useCallback, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  CAPTURE_MAX_BYTES,
  CAPTURE_TOO_BIG_MESSAGE,
  baseMime,
  type UploadKind,
} from '@/lib/capture-schema'
import { uploadKindOfMime } from '@/lib/capture-media'
import {
  classifySendError,
  markInFlight,
  outboxAdd,
  outboxMarkRetry,
  outboxRemove,
  unmarkInFlight,
  type OutboxItem,
} from '@/lib/outbox'
import { deliverItem, type SubmitPhase, type SubmitResult } from './outbox-delivery'

export type { SubmitPhase, SubmitResult }

/** Guess the kind of a picked file from its MIME type. */
export function kindOfFile(file: Blob): UploadKind | null {
  return uploadKindOfMime(file.type)
}

/**
 * Drives a capture from the browser, offline-first:
 *   1. the capture is written to the local outbox (IndexedDB) FIRST,
 *   2. then delivered (file → createUpload → PUT to Storage → submit; text → submitText),
 *   3. success removes it from the outbox; a network/server hiccup leaves it there
 *      and resolves with `{ queued: true }` — the flusher sends it by itself later.
 * Each item carries a clientId, so a retry after a lost response never duplicates.
 * `onCaptureId` fires as soon as the row exists, so the UI can already follow it
 * (and survive a reload while it processes).
 */
export function useCaptureSubmit() {
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const utils = trpc.useUtils()
  const submit = trpc.capture.submit.useMutation()

  const run = useCallback(
    async (item: OutboxItem, onCaptureId?: (id: string) => void): Promise<SubmitResult> => {
      markInFlight(item.clientId)
      try {
        const res = await deliverItem(utils.client, item, { onCaptureId, onPhase: setPhase })
        await outboxRemove(item.clientId)
        return res
      } catch (err) {
        if (classifySendError(err) === 'fatal') {
          // The server understood and refused (plan, type…): nothing to retry — tell the person.
          await outboxRemove(item.clientId)
          throw err
        }
        await outboxMarkRetry(item.clientId, err, { offline: typeof navigator !== 'undefined' && navigator.onLine === false })
        return { captureId: '', status: 'queued', error: null, queued: true }
      } finally {
        unmarkInFlight(item.clientId)
        setPhase('idle')
      }
    },
    [utils],
  )

  const sendFile = useCallback(
    async (
      file: Blob,
      kind: UploadKind,
      opts: { durationSec?: number; onCaptureId?: (id: string) => void } = {},
    ): Promise<SubmitResult> => {
      if (file.size > CAPTURE_MAX_BYTES) throw new Error(CAPTURE_TOO_BIG_MESSAGE)
      const mime = file.type ? baseMime(file.type) : undefined
      const item = await outboxAdd({ kind, blob: file, mime, durationSec: opts.durationSec })
      return run(item, opts.onCaptureId)
    },
    [run],
  )

  const sendText = useCallback(
    async (text: string): Promise<SubmitResult> => {
      const item = await outboxAdd({ kind: 'text', text })
      return run(item)
    },
    [run],
  )

  /** Re-run Faro's reading of a capture that already exists (failed / never submitted). */
  const retry = useCallback(
    async (captureId: string): Promise<SubmitResult> => {
      setPhase('processing')
      try {
        return await submit.mutateAsync({ captureId })
      } finally {
        setPhase('idle')
      }
    },
    [submit],
  )

  return { phase, busy: phase !== 'idle', sendFile, sendText, retry }
}
