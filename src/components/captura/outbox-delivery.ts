import type { trpc } from '@/lib/trpc/client'
import { baseMime } from '@/lib/capture-schema'
import { UploadHttpError, type OutboxItem } from '@/lib/outbox'

/** The plain tRPC client (no React state): usable from the flusher, timers and event handlers. */
export type CaptureClient = ReturnType<typeof trpc.useUtils>['client']

export type SubmitPhase = 'idle' | 'uploading' | 'processing'

export interface SubmitResult {
  captureId: string
  status: string
  error: string | null
  /** Kept in the outbox (offline / server hiccup): it will be sent by itself. */
  queued?: boolean
}

const DEFAULT_MIME = { audio: 'audio/webm', video: 'video/mp4', image: 'image/jpeg' } as const

/**
 * Deliver ONE outbox item to Faro:
 *   text  → submitText
 *   media → createUpload → PUT to the signed Storage URL → submit (Gemini)
 * Every step carries the item's clientId, so running it again after a lost
 * response returns the same capture instead of creating (and AI-processing) a
 * second one: if the server already has it past 'uploaded', we are done.
 */
export async function deliverItem(
  client: CaptureClient,
  item: OutboxItem,
  hooks: { onCaptureId?: (id: string) => void; onPhase?: (p: SubmitPhase) => void } = {},
): Promise<SubmitResult> {
  if (item.kind === 'text') {
    hooks.onPhase?.('processing')
    return await client.capture.submitText.mutate({ text: item.text ?? '', clientId: item.clientId })
  }

  const file = item.blob
  if (!file) throw new Error('La captura guardada no tiene archivo.') // storage evicted the blob: nothing to send

  hooks.onPhase?.('uploading')
  const mime = baseMime(item.mime || file.type || DEFAULT_MIME[item.kind])
  const up = await client.capture.createUpload.mutate({ kind: item.kind, mimeType: mime, clientId: item.clientId })
  hooks.onCaptureId?.(up.captureId)

  // Already with Faro (a previous attempt got through and only the answer was lost).
  if (!up.signedUrl) return { captureId: up.captureId, status: up.status, error: null }

  const res = await fetch(up.signedUrl, { method: 'PUT', headers: { 'Content-Type': mime, 'x-upsert': 'true' }, body: file })
  if (!res.ok) throw new UploadHttpError(res.status)

  hooks.onPhase?.('processing')
  return await client.capture.submit.mutate({ captureId: up.captureId, durationSec: item.durationSec })
}
