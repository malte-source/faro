'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, History, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldSelect } from '@/components/personas/field-select'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { useIsMobile } from '@/components/mobile/use-media'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { DocPreview } from '@/components/documentos/doc-render'
import { cn } from '@/lib/utils'

const dt = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// ── "Mejorar con IA" ────────────────────────────────────────────────────────

const IMPROVE_IDEAS = [
  'Hazlo más corto y directo',
  'Usa un tono más formal',
  'Agrega una tabla RACI',
  'Resuelve las ambigüedades',
  'Agrega métricas medibles',
  'Completa lo que falte con [COMPLETAR]',
]

/** Instruction box → Faro rewrites → the user accepts or discards the proposal. */
export function ImprovePanel({
  docId, body, initialInstruction, onAccept, onClose,
}: {
  docId: string
  body: string
  initialInstruction?: string
  onAccept: (newBody: string) => void
  onClose: () => void
}) {
  const [instruction, setInstruction] = useState(initialInstruction ?? '')
  const [proposal, setProposal] = useState<string | null>(null)
  const improve = trpc.documents.improve.useMutation({
    onSuccess: r => setProposal(r.body_md),
    onError: err => toast.error('No se pudo mejorar el documento', err.message),
  })

  return (
    <section className="rounded-xl border border-signal/50 bg-signal-wash/50 p-4 dark:border-signal/40 dark:bg-night-700" aria-label="Mejorar con IA">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-night dark:text-mist">
          <Sparkles className="h-4 w-4 text-signal-ink dark:text-signal" /> Mejorar con IA
        </h3>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night">
          <X className="h-4 w-4" />
        </button>
      </div>

      {proposal === null ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && instruction.trim().length >= 3 && !improve.isPending) improve.mutate({ id: docId, body_md: body, instruction }) }}
              placeholder="¿Qué quieres cambiar? Ej: agrega un apartado de excepciones"
              maxLength={600}
              aria-label="Instrucción para Faro"
              autoFocus
            />
            <Button
              variant="signal"
              className="h-11 sm:h-9"
              disabled={instruction.trim().length < 3 || improve.isPending}
              onClick={() => improve.mutate({ id: docId, body_md: body, instruction })}
            >
              {improve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Aplicar
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {IMPROVE_IDEAS.map(idea => (
              <button
                key={idea}
                type="button"
                onClick={() => setInstruction(idea)}
                className="min-h-[36px] rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-graphite hover:border-graphite hover:text-foreground md:min-h-0 md:px-2.5 md:text-xs"
              >
                {idea}
              </button>
            ))}
          </div>
          {improve.isPending && <p className="mt-2 text-xs text-graphite">Faro está reescribiendo el documento…</p>}
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-graphite">Propuesta de Faro. Revísala antes de aceptar: reemplaza el texto actual (la versión anterior queda en el historial).</p>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-stone bg-white p-4 dark:border-night-700 dark:bg-night">
            <DocPreview md={proposal} />
          </div>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setProposal(null)}>Probar otra instrucción</Button>
            <Button variant="outline" className="h-11 sm:h-9" onClick={onClose}>Descartar</Button>
            <Button variant="signal" className="h-11 sm:h-9" onClick={() => { onAccept(proposal); onClose() }}>
              <Check className="h-4 w-4" /> Aceptar cambios
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

// ── "Revisar con IA" ────────────────────────────────────────────────────────

const SEVERITY: Record<'alta' | 'media' | 'baja', { label: string; variant: 'danger' | 'warning' | 'secondary' }> = {
  alta: { label: 'Alta', variant: 'danger' },
  media: { label: 'Media', variant: 'warning' },
  baja: { label: 'Baja', variant: 'secondary' },
}

export function ReviewPanel({
  docId, onFix, onClose,
}: {
  docId: string
  onFix: (instruction: string) => void
  onClose: () => void
}) {
  const review = trpc.documents.review.useMutation({
    onError: err => toast.error('No se pudo revisar el documento', err.message),
  })
  // Run once when the panel opens.
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    review.mutate({ id: docId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="rounded-xl border border-stone bg-white p-4 dark:border-night-700 dark:bg-night" aria-label="Revisión con IA">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-night dark:text-mist">
          <AlertTriangle className="h-4 w-4 text-signal-ink dark:text-signal" /> Revisión de Faro
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => review.mutate({ id: docId })} disabled={review.isPending}>
            <RotateCcw className="h-3.5 w-3.5" /> Revisar de nuevo
          </Button>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {review.isPending && <p className="flex items-center gap-2 text-sm text-graphite"><Loader2 className="h-4 w-4 animate-spin" /> Faro está leyendo el documento…</p>}
      {review.data && review.data.findings.length === 0 && (
        <p className="text-sm text-success">No encontré problemas importantes. Aun así, que lo lea una persona antes de aprobarlo.</p>
      )}
      {review.data && review.data.findings.length > 0 && (
        <ul className="space-y-2">
          {review.data.findings.map((f, i) => (
            <li key={i} className="flex flex-wrap items-start gap-2.5 rounded-lg bg-mist p-2.5 dark:bg-night-700 sm:flex-nowrap">
              <Badge variant={SEVERITY[f.severity].variant} className="mt-0.5 shrink-0">{SEVERITY[f.severity].label}</Badge>
              <p className="min-w-0 flex-1 basis-[60%] text-sm text-body sm:basis-auto">{f.text}</p>
              <Button variant="ghost" size="sm" className="h-10 shrink-0 sm:h-8" onClick={() => onFix(`Corrige este hallazgo de la revisión: ${f.text}`)} title="Pedirle a Faro que lo corrija">
                <Sparkles className="h-3.5 w-3.5" /> Corregir
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Versiones ───────────────────────────────────────────────────────────────

export function VersionsDrawer({
  docId, canRestore, onRestored, onClose,
}: {
  docId: string
  canRestore: boolean
  onRestored: () => void
  onClose: () => void
}) {
  const { data, isLoading, error } = trpc.documents.versions.useQuery({ id: docId })
  const utils = trpc.useUtils()
  const [open, setOpen] = useState<string | null>(null)
  const isMobile = useIsMobile()
  const restore = trpc.documents.restore.useMutation({
    onSuccess: r => {
      toast.success('Versión restaurada', `Ahora estás en la versión ${r.version}.`)
      void utils.documents.invalidate()
      onRestored()
    },
    onError: err => toast.error('No se pudo restaurar', err.message),
  })

  const body = (
    <>
          {isLoading && <p className="text-sm text-graphite">Cargando…</p>}
          {error && <p className="text-sm text-danger">{error.message}</p>}
          {data && (
            <>
              <p className="mb-3 rounded-lg bg-signal-wash px-3 py-2 text-xs text-signal-ink dark:bg-night-700 dark:text-signal">
                Estás en la <strong>versión {data.current.version}</strong> (editada {dt(data.current.updatedAt)}). Las anteriores se guardan cuando empiezas una nueva sesión de edición o cuando se aprueba.
              </p>
              {data.versions.length === 0 && <p className="text-sm text-graphite">Todavía no hay versiones anteriores.</p>}
              <ul className="space-y-2">
                {data.versions.map(v => (
                  <li key={v.id} className="rounded-xl border border-stone p-3 dark:border-night-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-night dark:text-mist">
                          Versión {v.version} {v.isCurrent && <Badge variant="success" className="ml-1">Actual</Badge>}
                        </p>
                        <p className="text-xs text-graphite">{dt(v.savedAt)}{v.savedBy ? ` · ${v.savedBy.name}` : ''}</p>
                        {v.note && <p className="mt-1 text-xs italic text-ink-body dark:text-stone">{v.note}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setOpen(open === v.id ? null : v.id)}>{open === v.id ? 'Ocultar' : 'Ver'}</Button>
                        {canRestore && !v.isCurrent && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={restore.isPending}
                            onClick={async () => {
                              const ok = await confirmAction({
                                title: `Restaurar la versión ${v.version}`,
                                description: 'El texto actual se guarda en el historial y el documento vuelve a borrador.',
                                confirmLabel: 'Restaurar',
                              })
                              if (ok) restore.mutate({ id: docId, version: v.version })
                            }}
                          >
                            Restaurar
                          </Button>
                        )}
                      </div>
                    </div>
                    {open === v.id && (
                      <div className={cn('mt-3 max-h-64 overflow-y-auto rounded-lg border border-stone bg-mist p-3 dark:border-night-700 dark:bg-night-700')}>
                        <p className="mb-2 text-sm font-semibold text-night dark:text-mist">{v.title}</p>
                        <DocPreview md={v.bodyMd} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
    </>
  )

  // Phones: a bottom sheet; desktop: the right-hand drawer.
  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose} tall title="Versiones">
        <div className="pt-2">{body}</div>
      </BottomSheet>
    )
  }
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Versiones del documento">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-night/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:w-[26rem] dark:bg-night">
        <header className="flex items-center justify-between border-b border-stone px-4 py-3 dark:border-night-700">
          <h2 className="flex items-center gap-2 font-display text-base font-extrabold tracking-[-0.02em] text-night dark:text-mist">
            <History className="h-4 w-4" /> Versiones
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-full text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{body}</div>
      </aside>
    </div>
  )
}

// ── Diálogos del flujo ──────────────────────────────────────────────────────

export function ReviewerDialog({
  open, onClose, currentReviewerId, onSubmit, pending,
}: {
  open: boolean
  onClose: () => void
  currentReviewerId: string | null
  onSubmit: (reviewerId: string) => void
  pending: boolean
}) {
  const { data: dir } = trpc.membership.directory.useQuery(undefined, { staleTime: 60_000, enabled: open })
  const [reviewerId, setReviewerId] = useState<string>(currentReviewerId ?? '')
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <DialogTitle>Enviar a revisión</DialogTitle>
          <DialogDescription>La persona elegida podrá aprobar el documento o pedir cambios.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Quién revisa</Label>
            <FieldSelect value={reviewerId} onChange={setReviewerId} placeholder="Elige una persona…" options={(dir?.people ?? []).map(p => ({ value: p.id, label: p.name }))} />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="h-12 sm:h-9" onClick={onClose}>Cancelar</Button>
            <Button className="h-12 sm:h-9" disabled={!reviewerId || pending} onClick={() => onSubmit(reviewerId)}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ChangesDialog({
  open, onClose, onSubmit, pending,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (comment: string) => void
  pending: boolean
}) {
  const [comment, setComment] = useState('')
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <DialogTitle>Pedir cambios</DialogTitle>
          <DialogDescription>El documento vuelve a borrador y tu comentario queda en el historial de versiones.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Textarea rows={4} value={comment} onChange={e => setComment(e.target.value)} maxLength={600} placeholder="¿Qué hay que corregir?" aria-label="Comentario" autoFocus />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="h-12 sm:h-9" onClick={onClose}>Cancelar</Button>
            <Button className="h-12 sm:h-9" disabled={!comment.trim() || pending} onClick={() => { onSubmit(comment.trim()); setComment('') }}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Pedir cambios
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
