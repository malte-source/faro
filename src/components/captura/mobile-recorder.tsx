'use client'

import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Loader2, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import { CAPTURE_MAX_SECONDS } from '@/lib/capture-schema'
import { useCaptureSubmit } from './use-capture-submit'
import { formatClock, useRecorder, type RecordingResult } from './use-recorder'

/** Press shorter than this is a tap; longer starts recording. */
const HOLD_MS = 280
/** Slide this far (px) left or up to cancel. */
const CANCEL_PX = 90
/** Shorter recordings are treated as accidental. */
const MIN_SECONDS = 1

type Stage = 'idle' | 'recording' | 'sending'

/**
 * Center FAB of the mobile nav: **hold = record audio**, tap = `onTap`
 * (open the create sheet). Releasing sends the audio straight to Storage and
 * Faro; sliding left/up before releasing cancels. When Faro is done the user
 * lands on the review screen (/dashboard/capturar?c=…).
 */
export function MobileCaptureFab({ onTap, className }: { onTap?: () => void; className?: string }) {
  const router = useRouter()
  const { sendFile } = useCaptureSubmit()
  const [stage, setStage] = useState<Stage>('idle')
  const [willCancel, setWillCancel] = useState(false)

  const send = useCallback(
    async (r: RecordingResult) => {
      setStage('sending')
      try {
        const result = await sendFile(r.blob, 'audio', { durationSec: r.durationSec })
        router.push(`/dashboard/capturar?c=${result.captureId}`)
      } catch (e) {
        toast.error('No se pudo enviar el audio', e instanceof Error ? e.message : undefined)
      } finally {
        setStage('idle')
      }
    },
    [router, sendFile],
  )

  const recorder = useRecorder({ onLimit: r => void send(r) }) // 5-minute cap reached while still holding

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const holding = useRef(false)
  const cancelIntent = useRef(false)

  const clearTimer = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  const begin = async () => {
    holding.current = true
    setStage('recording')
    const ok = await recorder.start()
    if (!ok) {
      holding.current = false
      setStage('idle')
      toast.error('No pudimos usar el micrófono', 'Revisa el permiso del navegador e intenta de nuevo.')
      return
    }
    // Released while the permission prompt / mic warm-up was running.
    if (!holding.current) {
      recorder.cancel()
      setStage('idle')
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (stage !== 'idle') return
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = { x: e.clientX, y: e.clientY }
    cancelIntent.current = false
    setWillCancel(false)
    holding.current = false
    holdTimer.current = setTimeout(() => void begin(), HOLD_MS)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!holding.current) return
    const slid = origin.current.x - e.clientX > CANCEL_PX || origin.current.y - e.clientY > CANCEL_PX
    if (slid !== cancelIntent.current) {
      cancelIntent.current = slid
      setWillCancel(slid)
    }
  }

  const onPointerUp = async () => {
    clearTimer()
    if (!holding.current) {
      if (stage === 'idle') onTap?.() // quick tap
      return
    }
    holding.current = false
    if (cancelIntent.current) {
      recorder.cancel()
      setStage('idle')
      setWillCancel(false)
      return
    }
    const result = await recorder.stop()
    setWillCancel(false)
    if (!result || result.durationSec < MIN_SECONDS) {
      setStage('idle')
      toast.info('Mantén apretado para grabar')
      return
    }
    await send(result)
  }

  const onPointerCancel = () => {
    clearTimer()
    if (holding.current) {
      holding.current = false
      recorder.cancel()
      setStage('idle')
      setWillCancel(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Nueva tarea. Mantén apretado para grabar un audio"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => void onPointerUp()}
        onPointerCancel={onPointerCancel}
        onContextMenu={e => e.preventDefault()}
        className={cn(
          'flex h-14 w-14 touch-none select-none items-center justify-center rounded-full bg-signal text-night shadow-lg shadow-signal/30 transition-transform active:scale-95',
          className,
        )}
      >
        <Mic className="h-6 w-6" />
      </button>
      {stage !== 'idle' && typeof document !== 'undefined' &&
        createPortal(
          <RecorderScreen
            stage={stage}
            elapsed={recorder.elapsed}
            levels={recorder.levels}
            willCancel={willCancel}
          />,
          document.body,
        )}
    </>
  )
}

function RecorderScreen({
  stage,
  elapsed,
  levels,
  willCancel,
}: {
  stage: Stage
  elapsed: number
  levels: number[]
  willCancel: boolean
}) {
  const sending = stage === 'sending'
  return (
    <div
      className={cn(
        'fixed inset-0 z-[70] flex flex-col items-center bg-night px-6 pb-16 pt-24 text-mist',
        // While recording the finger is still on the FAB underneath: let events through.
        sending ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      role="dialog"
      aria-live="polite"
      aria-label={sending ? 'Enviando audio' : 'Grabando audio'}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
        {sending ? 'Enviando' : `Grabando · ${formatClock(elapsed)}`}
        {!sending && <span className="text-mist/50"> / {formatClock(CAPTURE_MAX_SECONDS)}</span>}
      </p>

      <p className="mt-6 max-w-[18rem] text-center font-display text-xl font-bold leading-snug tracking-tight text-stone">
        {sending ? 'Faro está leyendo…' : 'Cuéntale a Faro qué hay que hacer'}
      </p>

      <div className="mt-10 flex h-14 items-center gap-1" aria-hidden>
        {levels.map((l, i) => (
          <span
            key={i}
            className={cn('w-1 rounded-sm', sending ? 'bg-signal/40' : willCancel ? 'bg-danger' : 'bg-signal')}
            style={{ height: `${Math.round(6 + l * 48)}px`, transition: 'height 70ms linear' }}
          />
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-3">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-signal/20">
          <span className={cn('flex h-[72px] w-[72px] items-center justify-center rounded-full', willCancel ? 'bg-danger text-white' : 'bg-signal text-night')}>
            {sending ? <Loader2 className="h-7 w-7 animate-spin" /> : <Mic className="h-7 w-7" />}
          </span>
        </span>
        <p className={cn('text-sm', willCancel ? 'text-danger' : 'text-mist/60')}>
          {sending ? 'Esto toma unos segundos' : willCancel ? 'Suelta para cancelar' : 'Suelta para enviar · desliza para cancelar'}
        </p>
      </div>
    </div>
  )
}
