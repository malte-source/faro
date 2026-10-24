'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import { IconTile } from '@/components/mobile/inset-list'
import { cn } from '@/lib/utils'

/**
 * "Sacar tareas con IA": sends the conversation (channel or thread) to the
 * Captura pipeline as text and lands on its review screen, where the person
 * confirms the proposed tasks.
 *
 * `variant="row"` renders it as a full-width list row (used inside the phone
 * info sheet); the default is the compact header button.
 */
export function ExtractTasksButton({
  channelId,
  parentId,
  className,
  variant = 'button',
}: {
  channelId: string
  parentId?: string
  className?: string
  variant?: 'button' | 'row'
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const submit = trpc.capture.submitText.useMutation()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const transcript = await utils.chat.transcript.fetch({ channelId, parentId }, { staleTime: 0 })
      if (transcript.count === 0) {
        toast.info('No hay mensajes para analizar')
        return
      }
      const result = await submit.mutateAsync({ text: transcript.text })
      if (result.status === 'failed') {
        toast.error(result.error ?? 'No se pudo leer la conversación. Intenta de nuevo.')
      }
      router.push(`/dashboard/capturar?c=${result.captureId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo analizar la conversación')
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        className={cn('flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-border-soft disabled:opacity-60', className)}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center">
          <IconTile tone="neutral">{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}</IconTile>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-foreground">{busy ? 'Faro está leyendo…' : 'Sacar tareas con IA'}</span>
          {!busy && <span className="block text-[13px] text-graphite">Propone tareas desde esta conversación</span>}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      aria-busy={busy}
      title="Sacar tareas con IA"
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-stone px-3 text-xs font-medium text-ink-body transition-colors hover:border-signal hover:bg-signal-wash disabled:cursor-wait disabled:opacity-70 dark:border-[#1E3A4C] dark:text-stone dark:hover:bg-signal/10 md:h-8',
        className,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-signal-ink dark:text-signal" />}
      <span className={busy ? '' : 'hidden xl:inline'}>{busy ? 'Faro está leyendo…' : 'Sacar tareas con IA'}</span>
    </button>
  )
}
