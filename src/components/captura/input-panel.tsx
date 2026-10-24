'use client'

import { useRef, useState } from 'react'
import { FileText, ImageIcon, Mic, Square, Video, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { useIsIOS } from '@/components/pwa/platform'
import { CAPTURE_MAX_SECONDS, CAPTURE_TEXT_MAX_CHARS, type TranscriptLine } from '@/lib/capture-schema'
import { formatClock, useRecorder, type RecordingResult } from './use-recorder'
import { kindOfFile } from './use-capture-submit'
import { enqueueMedia } from './use-outbox'
import { KIND_TAG, READ_LABEL } from './captura-utils'

type Kind = 'audio' | 'video' | 'image' | 'text'

const KINDS: Array<{ kind: Kind; label: string; icon: LucideIcon; accept?: string }> = [
  { kind: 'audio', label: 'Audio', icon: Mic, accept: 'audio/*' },
  { kind: 'video', label: 'Video', icon: Video, accept: 'video/*' },
  { kind: 'image', label: 'Imagen', icon: ImageIcon, accept: 'image/*' },
  { kind: 'text', label: 'Texto', icon: FileText },
]

/**
 * Left column, "Qué mandas": the four sources + a drop zone (or the text box /
 * recorder). Picking a file sends it right away — nobody fills forms.
 */
export function SourcePicker({
  mode,
  onModeChange,
  disabled,
  onFile,
  onText,
}: {
  mode: Kind | null
  onModeChange: (m: Kind | null) => void
  disabled: boolean
  onFile: (file: Blob, kind: 'audio' | 'video' | 'image', durationSec?: number) => void
  onText: (text: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const isIOS = useIsIOS()
  const recorder = useRecorder({
    onLimit: r => sendRecording(r),
    // A call or the app switcher interrupted the recording: keep it, send when we're back in front.
    onInterrupt: r => {
      void enqueueMedia(r.blob, 'audio', { durationSec: r.durationSec })
      toast.info('Grabación guardada', 'Se enviará en cuanto vuelvas a Faro.')
    },
  })

  function sendRecording(r: RecordingResult) {
    onFile(r.blob, 'audio', r.durationSec)
  }

  const pick = (kind: Kind, accept?: string) => {
    onModeChange(kind)
    if (kind !== 'text' && inputRef.current) {
      inputRef.current.accept = accept ?? ''
      inputRef.current.click()
    }
  }

  const handleFile = (file: File | undefined | null) => {
    if (!file) return
    const kind = kindOfFile(file)
    if (!kind) return
    onFile(file, kind)
  }

  const toggleRecording = async () => {
    if (recorder.recording) {
      const r = await recorder.stop()
      if (r) sendRecording(r)
    } else {
      await recorder.start()
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-graphite">Qué mandas</p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-2">
        {KINDS.map(({ kind, label, icon: Icon, accept }) => {
          const active = mode === kind
          return (
            <button
              key={kind}
              type="button"
              disabled={disabled}
              onClick={() => pick(kind, accept)}
              aria-pressed={active}
              className={cn(
                'flex h-[72px] items-center justify-center gap-3 rounded-[14px] border-[1.5px] px-3 text-[15px] font-semibold transition-all active:scale-[0.98] disabled:opacity-50 sm:h-auto sm:flex-col sm:gap-1.5 sm:rounded-xl sm:px-1.5 sm:py-3 sm:text-[13px]',
                active
                  ? 'border-night bg-night text-mist dark:border-signal dark:bg-signal dark:text-night'
                  : 'border-border bg-surface text-foreground hover:border-graphite',
              )}
            >
              <Icon className="h-6 w-6 sm:h-[22px] sm:w-[22px]" strokeWidth={1.6} />
              {label}
            </button>
          )
        })}
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={e => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {mode === 'text' ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value.slice(0, CAPTURE_TEXT_MAX_CHARS))}
            rows={9}
            placeholder="Pega aquí notas de una reunión, un chat o un mail…"
            className="min-h-[220px] w-full resize-y rounded-[14px] border border-border bg-surface p-3.5 text-sm text-foreground placeholder:text-graphite focus:border-night focus:outline-none focus:ring-2 focus:ring-signal/40"
          />
          {/* Phones: the action rides on a bar pinned above the tab bar so it's always under the thumb. */}
          <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 pb-3 pt-3 backdrop-blur-xl sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <span className="text-xs tabular-nums text-graphite">{text.length.toLocaleString('es')} / {CAPTURE_TEXT_MAX_CHARS.toLocaleString('es')}</span>
            <Button variant="signal" className="h-12 flex-1 text-[15px] lg:h-9 lg:flex-none lg:text-sm" disabled={disabled || text.trim().length < 3} onClick={() => onText(text.trim())}>
              Analizar texto
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            if (!disabled) handleFile(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'flex min-h-[180px] flex-1 flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed p-5 text-center transition-colors sm:min-h-[220px] sm:p-6',
            dragging ? 'border-signal bg-signal-wash' : 'border-border',
          )}
        >
          {recorder.recording ? (
            <>
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-danger">
                Grabando · {formatClock(recorder.elapsed)} / {formatClock(CAPTURE_MAX_SECONDS)}
              </p>
              <div className="flex h-10 items-center gap-1" aria-hidden>
                {recorder.levels.map((l, i) => (
                  <span key={i} className="w-1 rounded-sm bg-signal" style={{ height: `${Math.round(5 + l * 34)}px` }} />
                ))}
              </div>
              <Button variant="default" className="h-12 w-full max-w-xs sm:h-9 sm:w-auto" onClick={() => void toggleRecording()}>
                <Square className="h-4 w-4 fill-current" /> Terminar y enviar
              </Button>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-bold text-foreground">
                <span className="hidden sm:inline">Suelta un archivo o elige qué enviar</span>
                <span className="sm:hidden">Elige qué enviar o graba una nota de voz</span>
              </p>
              <p className="max-w-[34ch] text-[13px] text-graphite">
                Notas de voz, videos cortos, fotos, capturas o texto pegado. Hasta 14 MB.
              </p>
              {isIOS && (
                <p className="max-w-[36ch] text-xs leading-snug text-graphite">
                  En iPhone no se puede compartir directo a Faro: pega el texto, o elige el archivo desde Archivos o Fotos con los botones de arriba.
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void toggleRecording()}
                className="mt-2 h-14 w-full max-w-xs border-signal bg-signal text-base font-semibold text-night hover:bg-signal/90 sm:mt-1 sm:h-8 sm:w-auto sm:max-w-none sm:border-night sm:bg-surface sm:text-xs sm:font-medium sm:text-foreground sm:hover:bg-background"
              >
                <Mic className="h-5 w-5 sm:h-4 sm:w-4" /> Grabar ahora
              </Button>
              {recorder.error && <p className="text-xs text-danger">{recorder.error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** The capture as sent: tag, title, meta, original (player / image / video / text) and the read transcript. */
export function OriginalCard({
  kind,
  title,
  meta,
  mediaUrl,
  rawText,
  transcript,
  activeLine,
  onLineHover,
  processing,
}: {
  kind: Kind
  title: string
  meta: string
  mediaUrl: string | null
  rawText?: string | null
  transcript: TranscriptLine[]
  activeLine: number | null
  onLineHover: (i: number | null) => void
  processing: boolean
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border-soft px-3.5 py-3">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-night font-mono text-[10px] text-signal">
          {KIND_TAG[kind]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-night dark:text-mist">{title}</p>
          <p className="mt-px truncate text-xs text-graphite">{meta}</p>
        </div>
      </div>

      {mediaUrl && kind === 'audio' && (
        <div className="mx-3.5 mt-3 rounded-[10px] bg-mist p-2 dark:bg-night-700">
          <audio controls src={mediaUrl} className="h-9 w-full" preload="metadata" />
        </div>
      )}
      {mediaUrl && kind === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl} alt="Imagen enviada" className="mx-3.5 mt-3 max-h-56 w-[calc(100%-1.75rem)] rounded-[10px] object-contain bg-mist dark:bg-night-700" />
      )}
      {mediaUrl && kind === 'video' && (
        <video controls src={mediaUrl} className="mx-3.5 mt-3 max-h-56 w-[calc(100%-1.75rem)] rounded-[10px] bg-night" preload="metadata" />
      )}

      <div className="px-3.5 pb-3.5 pt-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-graphite">{READ_LABEL[kind]}</p>
        {transcript.length === 0 ? (
          <p className="text-[13px] text-graphite">
            {processing ? 'Faro está leyendo…' : kind === 'text' ? (rawText ?? '') : 'No se pudo leer contenido en este archivo.'}
          </p>
        ) : (
          <div className="flex max-h-[260px] flex-col gap-1.5 overflow-auto">
            {transcript.map((l, i) => (
              <div
                key={i}
                onMouseEnter={() => onLineHover(i)}
                onMouseLeave={() => onLineHover(null)}
                className={cn(
                  'flex gap-2.5 rounded-lg px-2 py-1 text-[13px] leading-relaxed transition-colors',
                  activeLine === i ? 'bg-signal-wash text-night dark:bg-signal/15 dark:text-foreground' : 'text-foreground',
                )}
              >
                {kind !== 'text' && kind !== 'image' && (
                  <span className="w-[34px] shrink-0 pt-px font-mono text-[11px] text-graphite">{l.at ?? ''}</span>
                )}
                <span>
                  {l.speaker && <span className="font-semibold">{l.speaker} </span>}
                  {l.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

