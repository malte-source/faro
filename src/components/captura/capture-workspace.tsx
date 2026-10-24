'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, RotateCcw } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { useInvalidator } from '@/lib/trpc/invalidate'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { hatFor, proposalWarning, weekBounds } from '@/lib/multiempresa'
import { CAPTURE_FAILED_MESSAGE, CAPTURE_TOO_BIG_MESSAGE } from '@/lib/capture-schema'
import { OutboxChip } from '@/components/mobile/outbox-chip'
import { FaroMark } from '@/components/brand/logo'
import { OriginalCard, SourcePicker } from './input-panel'
import { ProposalCard, type ProposalView } from './proposal-card'
import { useCaptureSubmit } from './use-capture-submit'
import { formatClock } from './use-recorder'
import {
  KIND_LABEL,
  PROCESSING_STEPS,
  initials,
  lineIndexFor,
  warningNote,
  type CaptureData,
  type Directory,
} from './captura-utils'

type Kind = 'audio' | 'video' | 'image' | 'text'
type Edit = { included?: boolean; assigneeId?: string | null; workspaceId?: string | null; dueDate?: string | null }

interface Pending {
  kind: Kind
  /** Object URL of the file being sent, so the original shows up before the server has it. */
  previewUrl: string | null
}

/** Capture screen: "Qué mandas" on the left, Faro's proposal on the right. */
export function CaptureWorkspace() {
  const router = useRouter()
  const params = useSearchParams()
  const invalidate = useInvalidator()
  const utils = trpc.useUtils()

  const urlId = params.get('c')
  const [captureId, setCaptureIdState] = useState<string | null>(urlId)
  // Follow the URL when it changes from outside (e.g. the mobile recorder redirects here).
  const [prevUrlId, setPrevUrlId] = useState(urlId)
  if (urlId !== prevUrlId) {
    setPrevUrlId(urlId)
    setCaptureIdState(urlId)
  }
  const setCaptureId = (id: string | null) => {
    setCaptureIdState(id)
    router.replace(id ? `/dashboard/capturar?c=${id}` : '/dashboard/capturar')
  }

  const [mode, setMode] = useState<Kind | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [hoverProposal, setHoverProposal] = useState<string | null>(null)
  const [hoverLine, setHoverLine] = useState<number | null>(null)

  const submitter = useCaptureSubmit()
  const directory = trpc.membership.directory.useQuery(undefined, { staleTime: 60_000 })
  const { data, isLoading } = trpc.capture.get.useQuery(
    { captureId: captureId ?? '' },
    {
      enabled: !!captureId,
      refetchInterval: q => (q.state.data?.status === 'processing' ? 1000 : false),
    },
  )
  const recent = trpc.capture.list.useQuery(undefined, { staleTime: 15_000 })

  const updateProposal = trpc.capture.updateProposal.useMutation()
  const confirm = trpc.capture.confirm.useMutation({
    onSuccess: () => {
      invalidate.tasks()
      void utils.capture.invalidate()
    },
    onError: e => toast.error('No se pudo confirmar', e.message),
  })
  const discard = trpc.capture.discard.useMutation({
    onSuccess: () => {
      void utils.capture.invalidate()
      reset()
    },
  })

  // Revoke object URLs we create.
  const previewRef = useRef<string | null>(null)
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])

  function reset() {
    setPending(null)
    setEdits({})
    setMode(null)
    setCaptureId(null)
  }

  const dir = directory.data
  const isProcessing = !!pending || data?.status === 'processing'

  // ── Sending ────────────────────────────────────────────────────────────
  async function handleFile(file: Blob, kind: 'audio' | 'video' | 'image', durationSec?: number) {
    setEdits({})
    setCaptureIdState(null)
    const url = URL.createObjectURL(file)
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = url
    setPending({ kind, previewUrl: url })
    try {
      const res = await submitter.sendFile(file, kind, { durationSec, onCaptureId: id => setCaptureId(id) })
      if (res.queued) toast.info('Guardado en tu teléfono', 'Se enviará solo cuando vuelva la conexión.')
      else if (res.status === 'failed') toast.error(res.error ?? CAPTURE_FAILED_MESSAGE)
    } catch (e) {
      toast.error('No se pudo enviar', e instanceof Error ? e.message : undefined)
    } finally {
      setPending(null)
      void utils.capture.invalidate()
    }
  }

  async function handleText(text: string) {
    setEdits({})
    setPending({ kind: 'text', previewUrl: null })
    try {
      const res = await submitter.sendText(text)
      if (res.queued) {
        toast.info('Guardado en tu teléfono', 'Se enviará solo cuando vuelva la conexión.')
        return
      }
      setCaptureId(res.captureId)
      if (res.status === 'failed') toast.error(res.error ?? CAPTURE_FAILED_MESSAGE)
    } catch (e) {
      toast.error('No se pudo enviar', e instanceof Error ? e.message : undefined)
    } finally {
      setPending(null)
      void utils.capture.invalidate()
    }
  }

  async function retry() {
    if (!captureId) return
    setPending({ kind: (data?.kind as Kind) ?? 'audio', previewUrl: null })
    try {
      const res = await submitter.retry(captureId)
      if (res.status === 'failed') toast.error(res.error ?? CAPTURE_FAILED_MESSAGE)
    } catch (e) {
      toast.error('No se pudo reintentar', e instanceof Error ? e.message : undefined)
    } finally {
      setPending(null)
      void utils.capture.invalidate()
    }
  }

  // ── Landing from the Android share sheet (/dashboard/capturar/compartir redirects here) ──
  const sharedText = params.get('t')
  const shareAuto = params.get('auto') === '1'
  const shareError = params.get('error')
  const shareHandled = useRef(false)
  useEffect(() => {
    if (shareHandled.current) return
    if (shareError) {
      shareHandled.current = true
      toast.error(
        shareError === 'toobig' ? CAPTURE_TOO_BIG_MESSAGE
          : shareError === 'unsupported' ? 'Faro lee audio, video, fotos y texto. Ese archivo no se puede leer.'
          : shareError === 'empty' ? 'No llegó nada para analizar. Intenta compartir de nuevo.'
          : shareError === 'plan' ? 'Tu plan no incluye la captura con IA.'
          : 'No se pudo recibir lo que compartiste. Intenta de nuevo.',
      )
      router.replace('/dashboard/capturar')
      return
    }
    if (shareAuto && sharedText) {
      shareHandled.current = true
      setTimeout(() => void handleText(sharedText), 0) // after the effect: handleText updates state
      router.replace('/dashboard/capturar')
    }
    // handleText is recreated every render; this runs once per landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareAuto, sharedText, shareError])

  // A shared FILE arrives as a capture already uploaded: send it to Faro's reading right away.
  const autoSubmitted = useRef(false)
  useEffect(() => {
    if (!shareAuto || sharedText || autoSubmitted.current || !captureId || data?.status !== 'uploaded') return
    autoSubmitted.current = true
    void retry()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareAuto, sharedText, captureId, data?.status])

  // ── Review model: server proposals + local edits, recomputed instantly ─
  const review = useMemo(() => {
    if (!data || !dir) return null
    const today = dir.today
    const lines = data.transcript
    return data.proposals.map(p => {
      const e = edits[p.id] ?? {}
      const assigneeId = e.assigneeId !== undefined ? e.assigneeId : p.assigneeId
      const workspaceId = e.workspaceId !== undefined ? e.workspaceId : p.workspaceId
      const dueDate = e.dueDate !== undefined ? e.dueDate : p.dueDate
      const included = e.included !== undefined ? e.included : p.included
      const person = dir.people.find(x => x.id === assigneeId)
      const empresa = dir.workspaces.find(x => x.id === workspaceId)
      const monday = weekBounds(dueDate ?? today).monday
      const pct = assigneeId ? (data.loads[assigneeId]?.[monday] ?? 0) : null
      const code = proposalWarning({ assigneeId, workspaceId, loadPct: pct }, dir.people)
      const alternatives = workspaceId
        ? dir.people
            .filter(o => o.id !== assigneeId && o.memberships.some(m => m.workspaceId === workspaceId) && (data.loads[o.id]?.[monday] ?? 0) < 80)
            .map(o => o.name.split(' ')[0])
        : []
      const view: ProposalView = {
        id: p.id,
        title: p.title,
        quote: p.quote,
        quoteAt: p.quoteAt,
        assigneeId,
        workspaceId,
        dueDate,
        projectName: p.projectName,
        included,
        hat: !person ? 'Sin asignar' : (hatFor(person, workspaceId) ?? '—'),
        note: warningNote({ code, personName: person?.name, empresaName: empresa?.name, loadPct: pct ?? 0, alternatives }),
      }
      return { view, line: lineIndexFor(p.quote, p.quoteAt, lines) }
    })
  }, [data, dir, edits])

  const onProposalChange = (id: string, patch: Edit) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    const { included, assigneeId, workspaceId, dueDate } = patch
    updateProposal.mutate(
      { id, included, assigneeId, workspaceId, dueDate },
      {
        onError: err => {
          setEdits(prev => {
            const next = { ...prev }
            delete next[id]
            return next
          })
          void utils.capture.get.invalidate()
          toast.error('No se pudo guardar el cambio', err.message)
        },
      },
    )
  }

  const activeLine = hoverLine ?? (hoverProposal ? (review?.find(r => r.view.id === hoverProposal)?.line ?? null) : null)
  const activeProposals = new Set<string>()
  if (hoverProposal) activeProposals.add(hoverProposal)
  if (hoverLine !== null) review?.forEach(r => { if (r.line === hoverLine) activeProposals.add(r.view.id) })

  const kind: Kind | null = (data?.kind as Kind | undefined) ?? pending?.kind ?? null
  const hasCapture = !!captureId || !!pending

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1320px] gap-0 lg:min-h-[680px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* ── Left: what you send ─────────────────────────────────────── */}
        <div className={cn('flex min-w-0 flex-col gap-3.5 border-border p-4 sm:p-5 lg:border-r', hasCapture && 'order-2 lg:order-none')}>
          {/* Phones: the promise comes first, before the choices. */}
          {!hasCapture && (
            <div className="pt-1 lg:hidden">
              <p className="font-display text-[26px] font-extrabold leading-[1.08] tracking-[-0.035em] text-foreground">Envía lo que tengas. Faro arma las tareas.</p>
              <p className="mt-1.5 text-[14px] leading-snug text-graphite">Una nota de voz, una foto, un video o texto pegado. Tú revisas y confirmas.</p>
            </div>
          )}
          <OutboxChip />
          <SourcePicker
            mode={mode}
            onModeChange={m => { if (hasCapture && !isProcessing) reset(); setMode(m) }}
            disabled={isProcessing}
            onFile={(f, k, d) => void handleFile(f, k, d)}
            onText={t => void handleText(t)}
          />

          {hasCapture && kind && (
            <OriginalCard
              kind={kind}
              title={data ? `${KIND_LABEL[kind]} de ${data.authorName.split(' ')[0]}` : `${KIND_LABEL[kind]} nuevo`}
              meta={data ? captureMeta(data) : 'Enviando…'}
              mediaUrl={data?.mediaUrl ?? pending?.previewUrl ?? null}
              rawText={data?.rawText}
              transcript={data?.transcript ?? []}
              activeLine={activeLine}
              onLineHover={setHoverLine}
              processing={isProcessing}
            />
          )}

          {!hasCapture && (recent.data?.length ?? 0) > 0 && (
            <div className="mt-2">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-graphite">Recientes</p>
              <ul className="flex flex-col gap-1.5">
                {recent.data!.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setCaptureId(c.id)}
                      className="flex min-h-[56px] w-full items-center gap-3 rounded-[14px] border border-border bg-surface px-3.5 py-2 text-left text-sm active:bg-border-soft sm:min-h-0 sm:gap-2.5 sm:rounded-xl sm:px-3 sm:hover:border-graphite"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-night font-mono text-[10px] text-signal sm:h-7 sm:w-7 sm:rounded-lg sm:text-[9px]">
                        {{ audio: 'AUD', video: 'VID', image: 'IMG', text: 'TXT' }[c.kind]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] text-foreground sm:text-sm">{c.preview ?? 'Captura'}</span>
                      <span className="shrink-0 text-xs text-graphite">{statusLabel(c.status, c.proposalCount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Right: Faro's proposal ──────────────────────────────────── */}
        <div className={cn('flex min-w-0 flex-col gap-3 p-4 sm:p-5', hasCapture && 'order-1 lg:order-none')}>
          {!hasCapture && <div className="hidden lg:contents"><IdlePanel /></div>}

          {hasCapture && isLoading && !pending && <Loader2 className="mx-auto mt-16 h-6 w-6 animate-spin text-graphite" />}

          {isProcessing && kind && <ProcessingPanel kind={kind} uploading={submitter.phase === 'uploading'} />}

          {!isProcessing && data?.status === 'failed' && (
            <FailurePanel message={data.error ?? CAPTURE_FAILED_MESSAGE} canRetry={data.kind !== 'text'} onRetry={() => void retry()} onReset={reset} />
          )}

          {!isProcessing && data?.status === 'uploaded' && (
            <FailurePanel message="El archivo no terminó de subirse." canRetry onRetry={() => void retry()} onReset={reset} />
          )}

          {!isProcessing && data?.status === 'discarded' && (
            <FailurePanel message="Esta captura se descartó." canRetry={false} onRetry={() => {}} onReset={reset} />
          )}

          {!isProcessing && data?.status === 'ready' && review && dir && (
            <ReviewPanel
              review={review}
              dir={dir}
              activeProposals={activeProposals}
              confirming={confirm.isPending}
              onHover={(id, on) => setHoverProposal(on ? id : null)}
              onChange={onProposalChange}
              onConfirm={() => confirm.mutate({ captureId: data.id })}
              onDiscard={() => discard.mutate({ captureId: data.id })}
            />
          )}

          {!isProcessing && data?.status === 'confirmed' && (
            <DonePanel data={data} onReset={reset} />
          )}
        </div>
      </div>
    </div>
  )
}

function captureMeta(d: CaptureData): string {
  const when = new Date(d.createdAt).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  const parts = [`${d.authorName.split(' ')[0]}`]
  if (d.durationSec) parts.push(formatClock(d.durationSec))
  parts.push(when)
  parts.push(d.source === 'email' ? 'Email' : 'App')
  return parts.join(' · ')
}

function statusLabel(status: string, count: number): string {
  if (status === 'ready') return `${count} para confirmar`
  if (status === 'confirmed') return 'Confirmada'
  if (status === 'processing') return 'Leyendo…'
  if (status === 'failed') return 'No se pudo leer'
  return ''
}

// ── Right-hand panels ───────────────────────────────────────────────────

function IdlePanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center text-graphite">
      <FaroMark size={48} />
      <p className="font-display text-xl font-bold text-foreground">Envía lo que tengas. Faro arma las tareas.</p>
      <p className="max-w-[40ch] text-sm">Aquí aparecen las tareas que Faro propone. Tú corriges lo que haga falta y confirmas: nada se asigna sin tu OK.</p>
    </div>
  )
}

function ProcessingPanel({ kind, uploading }: { kind: Kind; uploading: boolean }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(v => Math.min(v + 1, 2)), 2500)
    return () => clearInterval(t)
  }, [])
  const steps = kind === 'text' ? PROCESSING_STEPS.text : ['Subiendo el archivo', ...PROCESSING_STEPS[kind]]
  const offset = kind === 'text' ? 0 : 1
  const current = uploading ? 0 : offset + tick

  return (
    <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center gap-4 py-12 sm:gap-3" role="status" aria-live="polite">
      <p className="mb-1 font-display text-2xl font-extrabold tracking-[-0.03em] text-foreground sm:text-xl sm:font-bold sm:tracking-normal">Faro está leyendo…</p>
      {steps.map((label, i) => {
        const done = i < current
        const now = i === current
        return (
          <div key={label} className={cn('flex items-center gap-3 text-[15px] sm:text-sm', done || now ? 'text-foreground' : 'text-graphite')}>
            <span
              className={cn(
                'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-bold sm:h-[22px] sm:w-[22px]',
                done ? 'bg-signal text-night' : now ? 'animate-pulse bg-signal text-night' : 'bg-border-soft text-foreground',
              )}
            >
              {done ? '✓' : ''}
            </span>
            {label}
          </div>
        )
      })}
    </div>
  )
}

function FailurePanel({
  message,
  canRetry,
  onRetry,
  onReset,
}: {
  message: string
  canRetry: boolean
  onRetry: () => void
  onReset: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="rounded-xl bg-danger-wash px-4 py-3 text-sm text-danger dark:bg-danger/15">{message}</p>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        {canRetry && (
          <Button variant="signal" className="h-12 sm:h-9" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" /> Reintentar
          </Button>
        )}
        <Button variant="outline" className="h-12 sm:h-9" onClick={onReset}>Empezar de nuevo</Button>
      </div>
    </div>
  )
}

function ReviewPanel({
  review,
  dir,
  activeProposals,
  confirming,
  onHover,
  onChange,
  onConfirm,
  onDiscard,
}: {
  review: Array<{ view: ProposalView; line: number }>
  dir: Directory
  activeProposals: Set<string>
  confirming: boolean
  onHover: (id: string, hovering: boolean) => void
  onChange: (id: string, patch: Edit) => void
  onConfirm: () => void
  onDiscard: () => void
}) {
  const total = review.length
  const selected = review.filter(r => r.view.included)
  const missing = selected.filter(r => !r.view.assigneeId).length
  const canConfirm = selected.length > 0 && missing === 0 && !confirming

  if (total === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="font-display text-xl font-bold text-foreground">No encontré tareas concretas</p>
        <p className="text-sm text-graphite">Faro solo propone pedidos, compromisos y pendientes. Prueba con otro audio o pega el texto.</p>
        <Button variant="outline" onClick={onDiscard}>Empezar de nuevo</Button>
      </div>
    )
  }

  const hint = missing > 0
    ? `${missing} tarea${missing === 1 ? ' necesita' : 's necesitan'} responsable`
    : `${selected.length} de ${total} seleccionadas`

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <p className="font-display text-[22px] font-extrabold tracking-tight text-foreground">
          {total} {total === 1 ? 'tarea propuesta' : 'tareas propuestas'}
        </p>
        <span className="text-[13px] text-graphite">Revisa y confirma. Nada se asigna sin tu OK.</span>
      </div>

      {review.map(({ view }) => (
        <ProposalCard
          key={view.id}
          p={view}
          people={dir.people}
          empresas={dir.workspaces}
          highlighted={activeProposals.has(view.id)}
          onHover={on => onHover(view.id, on)}
          onChange={patch => onChange(view.id, patch)}
        />
      ))}

      {/* Phones/tablets: confirm bar pinned above the tab bar; desktop: inline under the cards. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-border bg-surface/95 px-4 pb-3 pt-3 backdrop-blur-xl sm:-mx-5 sm:px-5 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <span className="w-full text-[13px] text-graphite sm:w-auto sm:min-w-[180px] sm:flex-1">{hint}</span>
        <Button variant="ghost" className="h-12 lg:h-9" onClick={onDiscard} disabled={confirming}>Descartar</Button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className={cn(
            'inline-flex h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[12px] px-5 text-[15px] font-semibold transition-all active:scale-[0.98] lg:h-11 lg:flex-none lg:rounded-[10px] lg:text-sm',
            canConfirm ? 'bg-night text-mist hover:bg-night-700 dark:bg-signal dark:text-night dark:hover:bg-signal/90' : 'cursor-not-allowed bg-border-soft text-graphite',
          )}
        >
          {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmar y avisar ({selected.length})
        </button>
      </div>
    </>
  )
}

function DonePanel({ data, onReset }: { data: CaptureData; onReset: () => void }) {
  const created = data.summary?.created ?? 0
  const notified = data.summary?.notified ?? []
  const people = notified.length
  return (
    <>
      <div className="rounded-2xl bg-night p-5 text-mist">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-signal">Listo</p>
        <p className="mb-1.5 font-display text-2xl font-extrabold tracking-tight">
          {created} {created === 1 ? 'tarea creada' : 'tareas creadas'}, {people} {people === 1 ? 'persona avisada' : 'personas avisadas'}
        </p>
        <p className="text-sm text-stone">Cada responsable ve su tarea en Hoy, con la frase de donde salió.</p>
      </div>
      {notified.map(n => (
        <div key={n.userId} className="flex min-h-[60px] items-center gap-3 rounded-[14px] border border-border bg-surface px-3.5 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-night text-[11px] font-bold text-mist">{initials(n.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{n.name}</p>
            <p className="mt-px truncate text-xs text-graphite">{n.tasks.join(' · ')}</p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-success-wash px-2.5 py-1 text-xs font-medium text-success">
            {n.channel === 'email' ? 'Email' : 'En la app'}
          </span>
        </div>
      ))}
      <Button variant="outline" className="h-12 w-full sm:h-9 sm:w-auto sm:self-start" onClick={onReset}>Capturar otra cosa</Button>
    </>
  )
}
