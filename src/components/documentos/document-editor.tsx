'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ArrowLeft, Bold, CheckCircle2, ChevronDown, Download, FileWarning, FolderKanban, Heading2, History, List, ListChecks,
  Loader2, MessageSquareWarning, MoreHorizontal, Printer, Send, Sparkles, Table2, Trash2, X,
} from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldSelect } from '@/components/personas/field-select'
import { Segmented } from '@/components/mobile/segmented'
import { MobileNavBar } from '@/components/mobile/nav-bar'
import { DocActionsSheet } from '@/components/documentos/doc-actions-sheet'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { DocPreview, downloadMarkdown, printDocument } from '@/components/documentos/doc-render'
import { ChangesDialog, ImprovePanel, ReviewPanel, ReviewerDialog, VersionsDrawer } from '@/components/documentos/editor-panels'
import { DOC_KINDS, DOC_KIND_LABEL, DOC_STATUS_BADGE, DOC_STATUS_LABEL } from '@/lib/documents'
import { cn } from '@/lib/utils'
import type { DocumentKind } from '@/types/database'

const ALL = '__all__'
const NONE = '__none__'
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })

export function DocumentEditor({ id }: { id: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data: doc, isLoading, error } = trpc.documents.get.useQuery({ id }, { refetchOnWindowFocus: false })
  const { data: dir } = trpc.membership.directory.useQuery(undefined, { staleTime: 60_000 })

  // ── Local editing state (seeded once from the server; autosaved) ──────────
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [seededFor, setSeededFor] = useState<string | null>(null)
  const [editTick, setEditTick] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const lastSaved = useRef({ title: '', body: '' })
  const latest = useRef({ title: '', body: '' })
  const saving = useRef(false)
  const rerun = useRef(false)
  const readyRef = useRef(false)
  const canEditRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const canEdit = doc?.permissions.canEdit ?? false

  // Seed the editor once per document (state adjusted during render, the documented pattern).
  const ready = !!doc && seededFor === doc.id
  if (doc && seededFor !== doc.id) {
    setSeededFor(doc.id)
    setTitle(doc.title)
    setBody(doc.bodyMd)
  }

  // Mirror values into refs for the async save / unmount paths. Declared before the effects that read them.
  useEffect(() => { latest.current = { title, body } }, [title, body])
  useEffect(() => { canEditRef.current = canEdit }, [canEdit])
  useEffect(() => {
    if (doc && seededFor === doc.id && !readyRef.current) {
      lastSaved.current = { title: doc.title, body: doc.bodyMd }
      readyRef.current = true
    }
  }, [doc, seededFor])

  const changeTitle = (v: string) => { setTitle(v); latest.current = { ...latest.current, title: v }; setSaveState('dirty'); setEditTick(t => t + 1) }
  const changeBody = (v: string) => { setBody(v); latest.current = { ...latest.current, body: v }; setSaveState('dirty'); setEditTick(t => t + 1) }

  const [serverMeta, setServerMeta] = useState<{ version: number; status: string } | null>(null)

  /** Save the current text. Concurrent calls collapse into one follow-up pass (no recursion, no lost edits). */
  const save = useCallback(async (opts?: { note?: string }) => {
    if (saving.current) { rerun.current = true; return }
    saving.current = true
    let note = opts?.note
    try {
      do {
        rerun.current = false
        const { title: t, body: b } = latest.current
        if (t === lastSaved.current.title && b === lastSaved.current.body && !note) { setSaveState('saved'); break }
        if (!t.trim()) break
        setSaveState('saving')
        try {
          const res = await utils.client.documents.update.mutate({ id, title: t, body_md: b, ...(note ? { note } : {}) })
          note = undefined
          lastSaved.current = { title: t, body: b }
          setServerMeta({ version: res.version, status: res.status })
          if (res.reopened) toast.info('El documento volvió a borrador', 'Cambió después de aprobarse: necesita una nueva aprobación.')
          if (res.reopened || res.snapshotted) void utils.documents.get.invalidate({ id })
          void utils.documents.list.invalidate()
          setSaveState(latest.current.title === t && latest.current.body === b ? 'saved' : 'dirty')
        } catch (err) {
          setSaveState('error')
          toast.error('No se pudo guardar', err instanceof Error ? err.message : undefined)
          break
        }
      } while (rerun.current)
    } finally {
      saving.current = false
    }
  }, [id, utils])

  const flush = useCallback(async () => {
    while (saving.current) await sleep(50)
    await save()
    while (saving.current) await sleep(50)
  }, [save])

  // Debounced autosave: 1.5 s after the last edit.
  useEffect(() => {
    if (!ready || !canEdit || editTick === 0) return
    const t = setTimeout(() => void save(), 1500)
    return () => clearTimeout(t)
  }, [editTick, ready, canEdit, save])

  // Don't lose the last keystrokes when navigating away or closing the tab.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const { title: t, body: b } = latest.current
      if (readyRef.current && (t !== lastSaved.current.title || b !== lastSaved.current.body || saving.current)) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      const { title: t, body: b } = latest.current
      if (readyRef.current && canEditRef.current && t.trim() && (t !== lastSaved.current.title || b !== lastSaved.current.body)) {
        void utils.client.documents.update.mutate({ id, title: t, body_md: b })
      }
    }
  }, [id, utils])

  // ── Metadata (saved immediately) ─────────────────────────────────────────
  const meta = trpc.documents.update.useMutation({
    onSuccess: () => { void utils.documents.get.invalidate({ id }); void utils.documents.list.invalidate() },
    onError: err => toast.error('No se pudo guardar el cambio', err.message),
  })

  // ── Workflow ─────────────────────────────────────────────────────────────
  const [reviewerOpen, setReviewerOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const afterWorkflow = () => { void utils.documents.invalidate() }
  const submit = trpc.documents.submitForReview.useMutation({
    onSuccess: () => { setReviewerOpen(false); toast.success('Enviado a revisión'); afterWorkflow() },
    onError: err => toast.error('No se pudo enviar a revisión', err.message),
  })
  const approve = trpc.documents.approve.useMutation({
    onSuccess: () => { toast.success('Documento aprobado'); afterWorkflow() },
    onError: err => toast.error('No se pudo aprobar', err.message),
  })
  const requestChanges = trpc.documents.requestChanges.useMutation({
    onSuccess: () => { setChangesOpen(false); toast.success('Cambios pedidos'); afterWorkflow() },
    onError: err => toast.error('No se pudo pedir cambios', err.message),
  })
  const obsolete = trpc.documents.markObsolete.useMutation({
    onSuccess: () => { toast.success('Marcado como obsoleto'); afterWorkflow() },
    onError: err => toast.error('No se pudo marcar como obsoleto', err.message),
  })
  const reopen = trpc.documents.reopen.useMutation({
    onSuccess: () => { toast.success('Documento reabierto como borrador'); afterWorkflow() },
    onError: err => toast.error('No se pudo reabrir', err.message),
  })
  const remove = trpc.documents.remove.useMutation({
    onSuccess: () => { void utils.documents.invalidate(); toast.success('Documento eliminado'); router.push('/dashboard/documentos') },
    onError: err => toast.error('No se pudo eliminar', err.message),
  })

  // ── Panels ───────────────────────────────────────────────────────────────
  const [improveOpen, setImproveOpen] = useState(false)
  const [improveSeed, setImproveSeed] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)

  // ── Markdown helpers ─────────────────────────────────────────────────────
  const wrap = (before: string, after = '', placeholder = '') => {
    const el = taRef.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e, value } = el
    const sel = value.slice(s, e) || placeholder
    changeBody(value.slice(0, s) + before + sel + after + value.slice(e))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length) })
  }
  const linePrefix = (prefix: string) => {
    const el = taRef.current
    if (!el) return
    const { selectionStart: s, value } = el
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    changeBody(value.slice(0, lineStart) + prefix + value.slice(lineStart))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + prefix.length, s + prefix.length) })
  }

  const status = (serverMeta?.status ?? doc?.status) as keyof typeof DOC_STATUS_LABEL | undefined
  const version = serverMeta?.version ?? doc?.version ?? 1

  const printMeta = useMemo(() => {
    if (!doc) return ''
    const parts = [DOC_KIND_LABEL[doc.kind], doc.workspace?.name ?? 'Todo el grupo', `v${version}`, DOC_STATUS_LABEL[status ?? doc.status]]
    if (doc.owner) parts.push(`Responsable: ${doc.owner.name}`)
    if (doc.approvedBy && doc.approvedAt) parts.push(`Aprobado por ${doc.approvedBy.name} el ${fmtDate(doc.approvedAt)}`)
    return parts.join(' · ')
  }, [doc, version, status])

  if (isLoading) return <><MobileNavBar title="Documento" /><div className="p-4 md:p-6"><div className="mx-auto h-64 max-w-5xl animate-pulse rounded-xl bg-stone-100 dark:bg-night-700" /></div></>
  if (error || !doc) {
    return (
      <div className="p-4 md:p-6">
        <div className="md:hidden"><MobileNavBar title="Documento" /></div>
        <EmptyState icon={AlertTriangle} title="No se pudo abrir el documento" description={error?.message ?? 'Puede que no exista o que no tengas acceso.'} action={<Link href="/dashboard/documentos"><Button size="sm" variant="outline">Volver a Documentos</Button></Link>} />
      </div>
    )
  }

  const perms = doc.permissions
  const cur = status ?? doc.status
  const busyWorkflow = submit.isPending || approve.isPending || requestChanges.isPending || obsolete.isPending || reopen.isPending || remove.isPending
  const people = dir?.people ?? []

  const saveLabel: Record<SaveState, string> = {
    idle: '', dirty: 'Sin guardar…', saving: 'Guardando…', saved: 'Guardado', error: 'Error al guardar',
  }

  const toolBtn = 'inline-flex h-10 w-10 items-center justify-center rounded-md text-graphite hover:bg-stone-100 hover:text-night disabled:opacity-40 active:bg-border-soft dark:hover:bg-night-700 dark:hover:text-mist md:h-8 md:w-8'

  const metaSummary = [DOC_KIND_LABEL[doc.kind], doc.workspace?.name ?? 'Todo el grupo', doc.reviewer ? `Revisa ${doc.reviewer.name.split(' ')[0]}` : 'Sin revisor'].join(' · ')

  return (
    <>
    <MobileNavBar
      title="Documento"
      actions={
        <>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[13px]">
            <Badge variant={DOC_STATUS_BADGE[cur]}>{DOC_STATUS_LABEL[cur]}</Badge>
            <span className="text-graphite">v{version}</span>
            <span className={cn('whitespace-nowrap', saveState === 'error' ? 'text-danger' : 'text-graphite')} aria-live="polite">
              {saveState === 'saving' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
              {saveLabel[saveState]}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium text-foreground active:bg-border-soft"
          >
            <MoreHorizontal className="h-4 w-4" /> Acciones
          </button>
        </>
      }
    />
    <div
      className="flex-1 overflow-y-auto"
      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() } }}
    >
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 md:px-6 md:py-6">
        {/* Title + status */}
        <div>
          <Link href="/dashboard/documentos" className="mb-2 hidden items-center gap-1 text-xs font-medium text-graphite hover:text-night dark:hover:text-mist md:inline-flex">
            <ArrowLeft className="h-3.5 w-3.5" /> Documentos
          </Link>
          <div className="flex flex-wrap items-start gap-3">
            <input
              value={title}
              onChange={e => changeTitle(e.target.value)}
              disabled={!canEdit}
              maxLength={160}
              aria-label="Título del documento"
              placeholder="Título del documento"
              className="min-w-0 flex-1 bg-transparent font-display text-[26px] font-extrabold leading-[1.1] tracking-[-0.035em] text-foreground outline-none placeholder:text-graphite focus-visible:ring-2 focus-visible:ring-signal/50 disabled:opacity-70 md:text-3xl md:tracking-[-0.02em]"
            />
            <div className="hidden items-center gap-2 pt-2 md:flex">
              <Badge variant={DOC_STATUS_BADGE[cur]}>{DOC_STATUS_LABEL[cur]}</Badge>
              <span className="text-xs text-graphite">v{version}</span>
              <span className={cn('text-xs', saveState === 'error' ? 'text-danger' : 'text-graphite')} aria-live="polite">
                {saveState === 'saving' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                {saveLabel[saveState]}
              </span>
            </div>
          </div>
        </div>

        {/* Banners */}
        {cur === 'aprobado' && (
          <div className="flex items-start gap-2 rounded-lg bg-success-wash px-3 py-2 text-sm text-success dark:bg-success/15">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Aprobado{doc.approvedBy ? ` por ${doc.approvedBy.name}` : ''}{doc.approvedAt ? ` el ${fmtDate(doc.approvedAt)}` : ''}. Si lo editas, vuelve a borrador y necesita una nueva aprobación.
              {doc.reviewOverdue && <strong className="ml-1 text-danger">La revisión periódica está vencida.</strong>}
            </span>
          </div>
        )}
        {cur === 'en_revision' && (
          <div className="flex items-start gap-2 rounded-lg bg-signal-wash px-3 py-2 text-sm text-signal-ink dark:bg-signal/10">
            <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{perms.canReview ? 'Este documento espera tu revisión.' : `En revisión${doc.reviewer ? ` por ${doc.reviewer.name}` : ''}.`}</span>
          </div>
        )}
        {cur === 'obsoleto' && (
          <div className="flex items-start gap-2 rounded-lg bg-stone-100 px-3 py-2 text-sm text-graphite dark:bg-night-700">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Documento obsoleto: solo lectura. {perms.canManage ? 'Puedes reabrirlo como borrador.' : ''}</span>
          </div>
        )}

        {/* Meta bar — phones show a one-line summary that expands */}
        <button
          type="button"
          onClick={() => setMetaOpen(o => !o)}
          aria-expanded={metaOpen}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-surface px-4 text-left active:bg-border-soft md:hidden"
        >
          <span className="min-w-0">
            <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-graphite">Detalles</span>
            <span className="block truncate text-[14px] text-foreground">{metaSummary}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-graphite transition-transform', metaOpen && 'rotate-180')} />
        </button>
        <div className={cn('grid gap-3 rounded-[14px] border border-border bg-surface p-3 sm:grid-cols-2 md:rounded-xl lg:grid-cols-4', !metaOpen && 'hidden md:grid')}>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-graphite">Tipo</span>
            <FieldSelect value={doc.kind} disabled={!canEdit} onChange={v => meta.mutate({ id, kind: v as DocumentKind })} options={DOC_KINDS.map(k => ({ value: k.value, label: k.label }))} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-graphite">Ámbito</span>
            <FieldSelect
              value={doc.workspaceId ?? ALL}
              disabled={!canEdit}
              onChange={v => meta.mutate({ id, workspaceId: v === ALL ? null : v })}
              options={[{ value: ALL, label: 'Todo el grupo' }, ...(dir?.workspaces ?? []).map(w => ({ value: w.id, label: w.name }))]}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-graphite">Revisa</span>
            <FieldSelect
              value={doc.reviewer?.id ?? NONE}
              disabled={!canEdit}
              onChange={v => meta.mutate({ id, reviewerId: v === NONE ? null : v })}
              options={[{ value: NONE, label: 'Sin revisor' }, ...people.map(p => ({ value: p.id, label: p.name }))]}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-graphite">Próxima revisión</span>
            <Input
              type="date"
              className="h-12 md:h-9"
              disabled={!canEdit}
              defaultValue={doc.nextReviewAt ?? ''}
              key={doc.nextReviewAt ?? 'none'}
              onChange={e => meta.mutate({ id, nextReviewAt: e.target.value || null })}
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2 text-xs text-graphite">
            <span>Responsable: <strong className="text-ink-body dark:text-stone">{doc.owner?.name ?? '—'}</strong></span>
            {doc.project && (
              <Link href={`/dashboard/projects/${doc.project.id}`} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 font-medium text-night hover:bg-stone dark:bg-night-700 dark:text-mist">
                <FolderKanban className="h-3 w-3" /> {doc.project.code} · {doc.project.name}
              </Link>
            )}
            {doc.task && (
              <Link href={doc.task.projectId ? `/dashboard/projects/${doc.task.projectId}` : '#'} className="inline-flex items-center gap-1 rounded-full bg-signal-wash px-2.5 py-1 font-medium text-signal-ink dark:bg-night-700 dark:text-signal">
                <ListChecks className="h-3 w-3" /> Tarea: {doc.task.title}
              </Link>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {doc.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-stone px-2 py-0.5 dark:border-night-700">
                  {t}
                  {canEdit && (
                    <button type="button" aria-label={`Quitar etiqueta ${t}`} onClick={() => meta.mutate({ id, tags: doc.tags.filter(x => x !== t) })}>
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {canEdit && doc.tags.length < 12 && (
                <input
                  value={tagDraft}
                  onChange={e => setTagDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && tagDraft.trim()) {
                      e.preventDefault()
                      const t = tagDraft.trim().slice(0, 30)
                      if (!doc.tags.includes(t)) meta.mutate({ id, tags: [...doc.tags, t] })
                      setTagDraft('')
                    }
                  }}
                  placeholder="+ etiqueta"
                  aria-label="Agregar etiqueta"
                  className="w-24 bg-transparent text-xs outline-none placeholder:text-graphite"
                />
              )}
            </span>
          </div>
        </div>

        {/* Workflow (+ tools on desktop; on phones the tools live in the Acciones sheet) */}
        <div className="flex flex-wrap items-center gap-2 [&>button]:h-12 [&>button]:flex-1 md:[&>button]:h-auto md:[&>button]:flex-none">
          {cur === 'borrador' && (
            <Button onClick={async () => { await flush(); setReviewerOpen(true) }} disabled={busyWorkflow}>
              <Send className="h-4 w-4" /> Enviar a revisión
            </Button>
          )}
          {cur === 'en_revision' && perms.canReview && (
            <>
              <Button variant="signal" disabled={busyWorkflow} onClick={async () => { await flush(); approve.mutate({ id }) }}>
                {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Aprobar
              </Button>
              <Button variant="outline" disabled={busyWorkflow} onClick={() => setChangesOpen(true)}>Pedir cambios</Button>
            </>
          )}
          {cur === 'aprobado' && perms.canManage && (
            <Button
              variant="outline"
              disabled={busyWorkflow}
              onClick={async () => {
                const ok = await confirmAction({ title: 'Marcar como obsoleto', description: 'El documento queda de solo lectura. Podrás reabrirlo como borrador.', confirmLabel: 'Marcar obsoleto' })
                if (ok) obsolete.mutate({ id })
              }}
            >
              Marcar obsoleto
            </Button>
          )}
          {cur === 'obsoleto' && perms.canManage && (
            <Button variant="outline" disabled={busyWorkflow} onClick={() => reopen.mutate({ id })}>Reabrir como borrador</Button>
          )}

          <span className="mx-1 hidden h-6 w-px bg-stone dark:bg-night-700 md:inline-block" />

          <Button variant="outline" size="sm" className="hidden md:inline-flex" disabled={!canEdit} onClick={() => { setImproveSeed(''); setImproveOpen(v => !v) }}>
            <Sparkles className="h-3.5 w-3.5" /> Mejorar con IA
          </Button>
          <Button variant="outline" size="sm" className="hidden md:inline-flex" disabled={!body.trim()} onClick={async () => { await flush(); setReviewOpen(true) }}>
            <AlertTriangle className="h-3.5 w-3.5" /> Revisar con IA
          </Button>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => setVersionsOpen(true)}>
            <History className="h-3.5 w-3.5" /> Versiones
          </Button>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => downloadMarkdown(title || doc.title, body)}>
            <Download className="h-3.5 w-3.5" /> .md
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => { if (!printDocument({ title: title || doc.title, meta: printMeta, body })) toast.error('El navegador bloqueó la ventana de impresión', 'Permite las ventanas emergentes para este sitio.') }}
          >
            <Printer className="h-3.5 w-3.5" /> Imprimir
          </Button>
          {perms.canManage && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto hidden text-danger hover:text-danger md:inline-flex"
              disabled={busyWorkflow}
              onClick={async () => {
                const ok = await confirmAction({ title: 'Eliminar documento', description: 'Se borra con todo su historial de versiones. No se puede deshacer.', confirmLabel: 'Eliminar', variant: 'destructive' })
                if (ok) remove.mutate({ id })
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Eliminar
            </Button>
          )}
        </div>

        {improveOpen && canEdit && (
          <ImprovePanel
            key={improveSeed}
            docId={id}
            body={body}
            initialInstruction={improveSeed}
            onClose={() => setImproveOpen(false)}
            onAccept={nb => {
              // Close the version being replaced so the AI change can be undone from Versiones.
              changeBody(nb)
              void save({ note: 'Antes de aplicar una mejora de Faro' })
            }}
          />
        )}
        {reviewOpen && (
          <ReviewPanel
            docId={id}
            onClose={() => setReviewOpen(false)}
            onFix={instruction => { setImproveSeed(instruction); setImproveOpen(true) }}
          />
        )}

        {/* Phones: one pane at a time */}
        <Segmented
          aria-label="Editar o ver la vista previa"
          className="md:hidden"
          value={tab}
          onChange={setTab}
          options={[{ value: 'edit', label: 'Editar' }, { value: 'preview', label: 'Vista previa' }]}
        />

        {/* Editor + preview */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className={cn('flex flex-col overflow-hidden rounded-[14px] border border-border bg-surface md:rounded-xl', tab !== 'edit' && 'hidden md:flex')}>
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="toolbar" aria-label="Formato" data-no-track>
              <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => linePrefix('## ')} title="Título de sección" aria-label="Título de sección"><Heading2 className="h-4 w-4" /></button>
              <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => wrap('**', '**', 'negrita')} title="Negrita" aria-label="Negrita"><Bold className="h-4 w-4" /></button>
              <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => linePrefix('- ')} title="Lista" aria-label="Lista"><List className="h-4 w-4" /></button>
              <button type="button" className={toolBtn} disabled={!canEdit} onClick={() => wrap('\n| Columna 1 | Columna 2 |\n|---|---|\n| ', ' | |\n', '')} title="Tabla" aria-label="Tabla"><Table2 className="h-4 w-4" /></button>
              <button type="button" className={cn(toolBtn, 'w-auto px-2 text-xs font-medium')} disabled={!canEdit} onClick={() => wrap('[COMPLETAR: ', ']', 'qué falta')} title="Marcador para completar">[COMPLETAR]</button>
              <span className="ml-auto shrink-0 whitespace-nowrap pr-2 text-[11px] text-graphite">{body.length.toLocaleString('es')} caracteres</span>
            </div>
            <textarea
              ref={taRef}
              value={body}
              onChange={e => changeBody(e.target.value)}
              disabled={!canEdit}
              spellCheck
              aria-label="Contenido del documento en Markdown"
              placeholder={'## Propósito\n\nEscribe aquí en Markdown…'}
              className="h-[55dvh] min-h-[18rem] w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-graphite disabled:opacity-70 md:h-[60vh] md:min-h-[22rem]"
            />
          </div>
          <div className={cn('h-[60dvh] min-h-[18rem] overflow-y-auto rounded-[14px] border border-border bg-surface p-4 md:h-[60vh] md:min-h-[22rem] md:rounded-xl md:p-5', tab !== 'preview' && 'hidden md:block')} aria-label="Vista previa" data-no-ptr>
            <DocPreview md={body} />
          </div>
        </div>
      </div>

      <DocActionsSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        status={cur}
        canEdit={canEdit}
        canManage={perms.canManage}
        canReview={perms.canReview}
        busy={busyWorkflow}
        hasBody={!!body.trim()}
        onSendReview={async () => { await flush(); setReviewerOpen(true) }}
        onApprove={async () => { await flush(); approve.mutate({ id }) }}
        onRequestChanges={() => setChangesOpen(true)}
        onObsolete={async () => {
          const ok = await confirmAction({ title: 'Marcar como obsoleto', description: 'El documento queda de solo lectura. Podrás reabrirlo como borrador.', confirmLabel: 'Marcar obsoleto' })
          if (ok) obsolete.mutate({ id })
        }}
        onReopen={() => reopen.mutate({ id })}
        onImprove={() => { setImproveSeed(''); setImproveOpen(true) }}
        onAiReview={async () => { await flush(); setReviewOpen(true) }}
        onVersions={() => setVersionsOpen(true)}
        onDownload={() => downloadMarkdown(title || doc.title, body)}
        onPrint={() => { if (!printDocument({ title: title || doc.title, meta: printMeta, body })) toast.error('El navegador bloqueó la ventana de impresión', 'Permite las ventanas emergentes para este sitio.') }}
        onDelete={async () => {
          const ok = await confirmAction({ title: 'Eliminar documento', description: 'Se borra con todo su historial de versiones. No se puede deshacer.', confirmLabel: 'Eliminar', variant: 'destructive' })
          if (ok) remove.mutate({ id })
        }}
      />

      {reviewerOpen && (
        <ReviewerDialog
          open
          onClose={() => setReviewerOpen(false)}
          currentReviewerId={doc.reviewer?.id ?? null}
          pending={submit.isPending}
          onSubmit={reviewerId => submit.mutate({ id, reviewerId })}
        />
      )}
      {changesOpen && (
        <ChangesDialog open onClose={() => setChangesOpen(false)} pending={requestChanges.isPending} onSubmit={comment => requestChanges.mutate({ id, comment })} />
      )}
      {versionsOpen && (
        <VersionsDrawer
          docId={id}
          canRestore={canEdit}
          onClose={() => setVersionsOpen(false)}
          onRestored={async () => {
            setVersionsOpen(false)
            const fresh = await utils.documents.get.fetch({ id })
            setTitle(fresh.title)
            setBody(fresh.bodyMd)
            lastSaved.current = { title: fresh.title, body: fresh.bodyMd }
            setServerMeta({ version: fresh.version, status: fresh.status })
            setSaveState('saved')
          }}
        />
      )}
    </div>
    </>
  )
}
