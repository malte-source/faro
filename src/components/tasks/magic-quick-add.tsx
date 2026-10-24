'use client'

import { useState, useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, X, Loader2, Check, ChevronRight, Mic, Square, Type, Image as ImageIcon, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'

interface Props {
  open: boolean
  onClose: () => void
}

type Mode = 'text' | 'audio' | 'image'

/**
 * AI-powered free-text task creator.
 *
 * Flow:
 *   1. User types something like
 *      "revisar contrato cliente Acme para el viernes alta @mancuello"
 *   2. Hit Enter → Gemini parses → preview modal shows the resolved plan
 *      (project, assignee, priority, deadline) — all editable
 *   3. Confirm → creates the task
 *
 * Stops sliding back to the form if the user wants to refine — Esc closes.
 *
 * Keyboard: bound to `Shift+N` from a parent (the sidebar registers it).
 */
export function MagicQuickAdd({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [recording, setRecording] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)
  const [imageBlob, setImageBlob] = useState<Blob | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const imageInputRef = useRef<HTMLInputElement>(null)
  const utils = trpc.useUtils()

  // Full-router invalidation — Mi día, Prioridades, byProject, list, stats all refresh.
  const onCreated = (data: { task?: { title: string } } | unknown) => {
    const title = (data as { task?: { title?: string } })?.task?.title
    toast.success(title ? `Tarea creada: ${title}` : 'Tarea creada')
    utils.tasks.invalidate()
    utils.projects.invalidate()
  }
  const onErr = (e: { message: string }) => toast.error('No se pudo crear la tarea', e.message)
  const parse = trpc.tasks.parseAndCreate.useMutation({ onSuccess: onCreated, onError: onErr })
  const parseAudio = trpc.tasks.parseAudioAndCreate.useMutation({ onSuccess: onCreated, onError: onErr })
  const parseImage = trpc.tasks.parseImageAndCreate.useMutation({ onSuccess: onCreated, onError: onErr })

  // Active mutation depends on mode (all share preview/created shape)
  const active = mode === 'audio' ? parseAudio : mode === 'image' ? parseImage : parse

  // Reset on open
  useEffect(() => {
    if (open) {
      setMode('text')
      setText('')
      setAudioBlob(null)
      setImageBlob(null)
      setImagePreviewUrl(null)
      setRecError(null)
      parse.reset(); parseAudio.reset(); parseImage.reset()
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  const preview = active.data?.stage === 'preview' ? active.data.plan : null
  const created = active.data?.stage === 'created' ? active.data.task : null

  function handleParse() {
    if (!text.trim() || parse.isPending) return
    parse.mutate({ text: text.trim(), confirmed: false })
  }

  function handleConfirm() {
    if (!preview) return
    const override = {
      title: preview.title,
      projectId: preview.projectId,
      assigneeId: preview.assigneeId,
      priority: preview.priority,
      dueDate: preview.dueDate,
    }
    if (mode === 'audio' && audioBlob) {
      void blobToBase64(audioBlob).then(b64 =>
        parseAudio.mutate({
          audioBase64: b64,
          mimeType: audioBlob.type || 'audio/webm',
          confirmed: true,
          override,
        }),
      )
    } else if (mode === 'image' && imageBlob) {
      void blobToBase64(imageBlob).then(b64 =>
        parseImage.mutate({
          imageBase64: b64,
          mimeType: imageBlob.type || 'image/png',
          confirmed: true,
          override,
        }),
      )
    } else {
      parse.mutate({ text: text.trim(), confirmed: true, override })
    }
  }

  function handleImageFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) return
    setImageBlob(file)
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImagePreviewUrl(URL.createObjectURL(file))
  }
  async function processImage() {
    if (!imageBlob) return
    const b64 = await blobToBase64(imageBlob)
    parseImage.mutate({
      imageBase64: b64,
      mimeType: imageBlob.type || 'image/png',
      confirmed: false,
    })
  }

  async function startRecording() {
    setRecError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        stream.getTracks().forEach(t => t.stop())
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'No se pudo acceder al micrófono.')
    }
  }
  function stopRecording() {
    recorderRef.current?.stop()
    setRecording(false)
  }
  async function processAudio() {
    if (!audioBlob) return
    const b64 = await blobToBase64(audioBlob)
    parseAudio.mutate({
      audioBase64: b64,
      mimeType: audioBlob.type || 'audio/webm',
      confirmed: false,
    })
  }

  function handleClose() {
    setText(''); setAudioBlob(null); setRecording(false)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    parse.reset(); parseAudio.reset()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/40 px-0 backdrop-blur-sm md:items-start md:px-4 md:pt-24">
      <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[26px] border border-stone bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl animate-in slide-in-from-bottom dark:border-signal/40 dark:bg-night md:overflow-hidden md:rounded-2xl md:pb-0 md:slide-in-from-bottom-0">
        <span className="mx-auto mt-2.5 mb-1 block h-1 w-10 shrink-0 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 dark:border-night-700">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-night dark:text-stone-100">Quick Add con AI</p>
            <p className="text-[10px] uppercase tracking-wider text-graphite">
              Dile a Gemini qué tarea quieres crear
            </p>
          </div>
          <button onClick={handleClose} className="rounded-md p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1: Input (or just-created confirmation) */}
        {created ? (
          <div className="px-4 py-6 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success-wash dark:bg-success/40">
              <Check className="h-5 w-5 text-success" />
            </div>
            <p className="mt-3 text-sm font-semibold text-night dark:text-stone-100">
              ¡Tarea creada!
            </p>
            <p className="mt-1 text-xs text-graphite">{created.title}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => { setText(''); parse.reset() }}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90"
              >Crear otra</button>
              <button
                onClick={handleClose}
                className="rounded-lg border border-stone px-3 py-1.5 text-xs font-medium text-ink-body hover:bg-mist dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
              >Cerrar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-4">
              {/* Mode toggle: text vs audio */}
              <div className="mb-2 inline-flex rounded-lg border border-stone p-0.5 dark:border-ink-body">
                <button
                  onClick={() => { setMode('text'); parseAudio.reset(); setAudioBlob(null) }}
                  className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                    mode === 'text' ? 'bg-foreground text-background' : 'text-graphite hover:text-ink-body dark:text-graphite')}
                >
                  <Type className="h-3 w-3" /> Texto
                </button>
                <button
                  onClick={() => { setMode('audio'); parse.reset(); parseImage.reset() }}
                  className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                    mode === 'audio' ? 'bg-foreground text-background' : 'text-graphite hover:text-ink-body dark:text-graphite')}
                >
                  <Mic className="h-3 w-3" /> Audio
                </button>
                <button
                  onClick={() => { setMode('image'); parse.reset(); parseAudio.reset() }}
                  className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                    mode === 'image' ? 'bg-foreground text-background' : 'text-graphite hover:text-ink-body dark:text-graphite')}
                >
                  <ImageIcon className="h-3 w-3" /> Imagen
                </button>
              </div>

              {mode === 'text' ? (
                <>
                  <textarea
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                        e.preventDefault()
                        if (preview) handleConfirm()
                        else handleParse()
                      }
                    }}
                    disabled={parse.isPending}
                    rows={3}
                    placeholder='Ej: "revisar contrato cliente Acme para el viernes alta @mancuello"'
                    className="w-full resize-none rounded-lg border border-stone px-3 py-2 text-sm outline-none transition focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50 dark:border-ink-body dark:bg-night-700"
                  />
                  <p className="mt-2 text-[10px] text-graphite">
                    💡 Gemini infiere proyecto, asignado, prioridad y fecha. Tip: usa @nombre, &ldquo;mañana&rdquo;, códigos como P-12.
                  </p>
                </>
              ) : (
                /* AUDIO mode */
                <div className="flex flex-col items-center gap-3 rounded-lg border border-stone bg-mist/50 px-4 py-5 dark:border-ink-body dark:bg-night-700/40">
                  {!audioBlob && !recording && (
                    <>
                      <button
                        onClick={startRecording}
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition hover:bg-foreground/90"
                      >
                        <Mic className="h-7 w-7" />
                      </button>
                      <p className="text-xs text-graphite">Presiona para grabar tu tarea hablada</p>
                    </>
                  )}
                  {recording && (
                    <>
                      <button
                        onClick={stopRecording}
                        className="relative flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg transition hover:bg-danger"
                      >
                        <Square className="h-6 w-6" />
                        <span className="absolute inset-0 animate-ping rounded-full bg-danger/40" />
                      </button>
                      <p className="text-xs font-semibold text-danger">Grabando… presiona para detener</p>
                    </>
                  )}
                  {audioBlob && !recording && (
                    <>
                      <p className="text-xs text-ink-body dark:text-stone">
                        ✓ Audio grabado ({Math.round(audioBlob.size / 1024)} KB)
                      </p>
                      <audio controls src={URL.createObjectURL(audioBlob)} className="w-full max-w-xs" />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAudioBlob(null)}
                          className="rounded-md border border-stone px-2.5 py-1 text-[11px] font-medium hover:bg-stone-100 dark:border-graphite dark:hover:bg-ink-body"
                        >
                          Regrabar
                        </button>
                        {!preview && (
                          <button
                            onClick={processAudio}
                            disabled={parseAudio.isPending}
                            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
                          >
                            <Sparkles className="h-3 w-3" />
                            Procesar con Gemini
                          </button>
                        )}
                      </div>
                      {parseAudio.data?.stage === 'preview' && parseAudio.data.plan._transcript && (
                        <p className="max-w-md text-[11px] italic text-graphite">
                          &ldquo;{parseAudio.data.plan._transcript}&rdquo;
                        </p>
                      )}
                    </>
                  )}
                  {recError && <p className="text-xs text-danger">{recError}</p>}
                </div>
              )}

              {mode === 'image' && (
                <div
                  className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-stone bg-mist/50 px-4 py-5 transition hover:border-signal/50 dark:border-ink-body dark:bg-night-700/40"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleImageFile(e.dataTransfer.files?.[0]) }}
                >
                  {!imageBlob ? (
                    <>
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition hover:bg-foreground/90"
                      >
                        <Upload className="h-7 w-7" />
                      </button>
                      <p className="text-xs text-graphite text-center">
                        Arrastra una imagen o haz clic<br />
                        <span className="text-[10px]">screenshot, foto de pizarra, brief, post-it…</span>
                      </p>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleImageFile(e.target.files?.[0])}
                      />
                    </>
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreviewUrl ?? ''} alt="" className="max-h-48 rounded-md shadow-sm" />
                      <p className="text-xs text-ink-body dark:text-stone">
                        ✓ Imagen cargada ({Math.round(imageBlob.size / 1024)} KB)
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setImageBlob(null); setImagePreviewUrl(null); parseImage.reset() }}
                          className="rounded-md border border-stone px-2.5 py-1 text-[11px] font-medium hover:bg-stone-100 dark:border-graphite dark:hover:bg-ink-body"
                        >Cambiar</button>
                        {!preview && (
                          <button
                            onClick={processImage}
                            disabled={parseImage.isPending}
                            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
                          >
                            <Sparkles className="h-3 w-3" />
                            Procesar con Gemini
                          </button>
                        )}
                      </div>
                      {parseImage.data?.stage === 'preview' && parseImage.data.plan._transcript && (
                        <p className="max-w-md text-[11px] italic text-graphite text-center">
                          OCR: &ldquo;{parseImage.data.plan._transcript.slice(0, 200)}{parseImage.data.plan._transcript.length > 200 ? '…' : ''}&rdquo;
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {active.isPending && (
                <div className="mt-3 flex items-center gap-2 text-xs text-signal-ink">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Procesando con Gemini…
                </div>
              )}

              {/* Preview the parsed plan, editable */}
              {preview && !active.isPending && (
                <div className="mt-4 rounded-lg border border-stone bg-signal-wash/40 p-3 dark:border-signal/40 dark:bg-signal/20">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-night dark:text-signal">
                    Vista previa
                  </p>
                  <p className="text-sm font-semibold text-night dark:text-stone-100">{preview.title}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <PlanRow label="Proyecto" value={preview._projectLabel ?? '(primero disponible)'} />
                    <PlanRow label="Asignado" value={preview._assigneeLabel ?? '(sin asignar)'} />
                    <PlanRow label="Prioridad" value={preview.priority} />
                    <PlanRow label="Vence" value={preview.dueDate ?? '(sin fecha)'} />
                  </dl>
                </div>
              )}

              {active.isError && (
                <p className="mt-2 text-xs text-danger">
                  Error: {active.error.message}
                </p>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-2 border-t border-stone-100 bg-mist px-4 py-2 dark:border-night-700 dark:bg-night-700/40">
              <p className="text-[10px] text-graphite">
                <kbd className="rounded bg-white px-1 py-0.5 font-mono text-[9px] text-graphite shadow-sm dark:bg-night dark:text-stone">Enter</kbd>
                {preview ? ' confirmar · ' : ' parsear · '}
                <kbd className="rounded bg-white px-1 py-0.5 font-mono text-[9px] text-graphite shadow-sm dark:bg-night dark:text-stone">Esc</kbd> cerrar
              </p>
              {preview ? (
                <button
                  onClick={handleConfirm}
                  disabled={active.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
                >
                  Crear tarea
                  <ChevronRight className="h-3 w-3" />
                </button>
              ) : mode === 'text' ? (
                <button
                  onClick={handleParse}
                  disabled={!text.trim() || active.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
                >
                  Parsear con Gemini
                  <Sparkles className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('flex justify-between gap-2')}>
      <dt className="text-graphite">{label}</dt>
      <dd className="truncate font-medium text-night-700 dark:text-stone">{value}</dd>
    </div>
  )
}

/** Convert a Blob to a raw base64 string (no data URI prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
