'use client'

import { useCallback, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  CAPTURE_MAX_BYTES,
  CAPTURE_TOO_BIG_MESSAGE,
  baseMime,
  type UploadKind,
} from '@/lib/capture-schema'

export type SubmitPhase = 'idle' | 'uploading' | 'processing'

export interface SubmitResult {
  captureId: string
  status: string
  error: string | null
}

/** Guess the kind of a picked file from its MIME type. */
export function kindOfFile(file: Blob): UploadKind | null {
  const t = file.type.toLowerCase()
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('image/')) return 'image'
  return null
}

/**
 * Drives a capture from the browser:
 *   file  → createUpload → PUT to the signed Storage URL → submit (Gemini)
 *   text  → submitText
 * `onCaptureId` fires as soon as the row exists, so the UI can already
 * follow it (and survive a reload while it processes).
 */
export function useCaptureSubmit() {
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const createUpload = trpc.capture.createUpload.useMutation()
  const submit = trpc.capture.submit.useMutation()
  const submitText = trpc.capture.submitText.useMutation()

  const sendFile = useCallback(
    async (
      file: Blob,
      kind: UploadKind,
      opts: { durationSec?: number; onCaptureId?: (id: string) => void } = {},
    ): Promise<SubmitResult> => {
      if (file.size > CAPTURE_MAX_BYTES) throw new Error(CAPTURE_TOO_BIG_MESSAGE)
      setPhase('uploading')
      try {
        const mime = baseMime(file.type || (kind === 'audio' ? 'audio/webm' : kind === 'video' ? 'video/mp4' : 'image/jpeg'))
        const up = await createUpload.mutateAsync({ kind, mimeType: mime })
        opts.onCaptureId?.(up.captureId)
        const res = await fetch(up.signedUrl, { method: 'PUT', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: file })
        if (!res.ok) throw new Error('No se pudo subir el archivo. Intenta de nuevo.')
        setPhase('processing')
        return await submit.mutateAsync({ captureId: up.captureId, durationSec: opts.durationSec })
      } finally {
        setPhase('idle')
      }
    },
    [createUpload, submit],
  )

  const sendText = useCallback(
    async (text: string): Promise<SubmitResult> => {
      setPhase('processing')
      try {
        return await submitText.mutateAsync({ text })
      } finally {
        setPhase('idle')
      }
    },
    [submitText],
  )

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
