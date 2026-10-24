'use client'

import { useState, useRef } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  Video, X, Upload, Sparkles, Loader2, CheckCircle2, AlertCircle, Trash2,
} from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { useEscapeClose } from '@/hooks/use-escape-close'

interface Props {
  /** Pre-select a project when opened from a project context. */
  defaultProjectId?: string
  onClose: () => void
}

type DraftTask = {
  title: string
  description: string | null
  project_id: string | null
  assignee_id: string | null
  priority?: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
  due_date: string | null
  confidence?: 'high' | 'medium' | 'low'
}

type ProjectOpt = { id: string; code: string; name: string }
type MemberOpt = { id: string; name: string }

/**
 * Meeting notes → tasks importer.
 *
 * The flow is intentionally two-step (paste → preview → confirm). Meeting
 * transcripts are noisy and Gemini sometimes hallucinates tasks; we never
 * commit without the user reviewing.
 *
 * Inputs supported:
 *   1. Paste raw text (transcript, email body with "Notas de Gemini", etc.)
 *   2. Drag-drop a .txt file (FileReader → text)
 *
 * Output:
 *   List of draft tasks with editable: title, project, assignee, priority,
 *   due_date. User selects which to keep via checkboxes (all checked by
 *   default), edits any field, hits "Crear N tareas".
 */
export function MeetingImportModal({ defaultProjectId, onClose }: Props) {
  const [rawText, setRawText] = useState('')
  const [defaultProject, setDefaultProject] = useState(defaultProjectId ?? '')
  const [drafts, setDrafts] = useState<DraftTask[]>([])
  const [keepFlags, setKeepFlags] = useState<boolean[]>([])
  const [projects, setProjects] = useState<ProjectOpt[]>([])
  const [members, setMembers] = useState<MemberOpt[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const utils = trpc.useUtils()
  useEscapeClose(onClose)

  const parse = trpc.tasks.parseMeetingNotes.useMutation({
    onSuccess: (data) => {
      setDrafts(data.tasks)
      setKeepFlags(data.tasks.map(() => true))
      setProjects(data.projects)
      setMembers(data.members)
      if (data.tasks.length === 0) {
        toast.warning('Sin action items detectados', 'Prueba con notas más detalladas o copia la transcripción completa.')
      } else {
        toast.success(`Detecté ${data.tasks.length} tarea${data.tasks.length === 1 ? '' : 's'}`, 'Revísalas y edita lo que haga falta antes de crear.')
      }
    },
    onError: (e) => toast.error('No se pudo procesar', e.message),
  })

  const bulkCreate = trpc.tasks.bulkCreate.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.created} tarea${data.created === 1 ? '' : 's'} creada${data.created === 1 ? '' : 's'}`)
      utils.tasks.invalidate()
      utils.projects.invalidate()
      onClose()
    },
    onError: (e) => toast.error('Error al crear', e.message),
  })

  function handleParse() {
    if (rawText.trim().length < 20) {
      toast.warning('Pega al menos 20 caracteres de notas para analizar')
      return
    }
    parse.mutate({
      rawText: rawText.trim(),
      defaultProjectId: defaultProject || undefined,
    })
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    readFile(file)
  }

  function readFile(file: File) {
    // Accept .txt, .md, .vtt (Meet transcripts), .srt
    const allowed = /\.(txt|md|vtt|srt|log)$/i.test(file.name)
    if (!allowed && !file.type.startsWith('text/')) {
      toast.warning('Formato no soportado', 'Sube un archivo de texto (.txt, .md, .vtt, .srt) o pega el contenido.')
      return
    }
    if (file.size > 500_000) {
      toast.warning('Archivo muy grande', 'Máximo 500KB. Recorta las notas.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setRawText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  function updateDraft(i: number, patch: Partial<DraftTask>) {
    setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }
  function removeDraft(i: number) {
    setDrafts(prev => prev.filter((_, idx) => idx !== i))
    setKeepFlags(prev => prev.filter((_, idx) => idx !== i))
  }
  function toggleKeep(i: number) {
    setKeepFlags(prev => prev.map((k, idx) => idx === i ? !k : k))
  }

  function handleCreate() {
    const toCreate = drafts
      .filter((_, i) => keepFlags[i])
      .map(d => ({
        title: d.title,
        description: d.description,
        projectId: d.project_id ?? defaultProject,
        assigneeId: d.assignee_id,
        priority: d.priority ?? 'medium' as const,
        dueDate: d.due_date,
      }))
      .filter(t => t.projectId)  // skip any without a project

    if (toCreate.length === 0) {
      toast.warning('No hay tareas para crear', 'Asigna un proyecto a las que no tienen.')
      return
    }
    bulkCreate.mutate({ tasks: toCreate })
  }

  const hasPreview = drafts.length > 0
  const selectedCount = keepFlags.filter(Boolean).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 animate-in fade-in md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[26px] bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl animate-in slide-in-from-bottom dark:bg-night md:max-h-[92vh] md:max-w-3xl md:rounded-2xl md:pb-0 md:zoom-in-95 md:slide-in-from-bottom-0"
        onClick={e => e.stopPropagation()}
      >
        <span className="mx-auto mt-2.5 mb-1 block h-1 w-10 shrink-0 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
        {/* Header */}
        <header className="flex shrink-0 items-center gap-3 border-b border-stone-100 px-5 py-4 dark:border-night-700">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
            <Video className="h-4 w-4 text-signal-ink" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-night dark:text-stone-100">
              Importar tareas desde reunión
            </h2>
            <p className="text-[11px] text-graphite">
              Pega las notas de Gemini, transcripción de Meet, o un email con minuta. Sacamos los action items con AI.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!hasPreview ? (
            <div className="space-y-3">
              {/* Optional default project */}
              <label className="block">
                <span className="text-xs font-medium text-graphite dark:text-stone">
                  Proyecto por defecto (para tareas sin proyecto detectado)
                </span>
                <input
                  type="text"
                  list="meeting-project-list"
                  value={defaultProject}
                  onChange={e => setDefaultProject(e.target.value)}
                  placeholder="Elige o deja vacío para que la AI lo detecte por tarea"
                  className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
                />
              </label>

              {/* Drop zone + textarea */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`relative rounded-xl border-2 border-dashed transition ${
                  dragOver
                    ? 'border-signal/50 bg-signal-wash/40 dark:bg-signal/20'
                    : 'border-stone dark:border-ink-body'
                }`}
              >
                <textarea
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  placeholder={`Pega aquí:
• Notas generadas por Gemini en la reunión
• Transcripción de Meet
• Cuerpo del email con minuta
• O arrastra un archivo .txt / .vtt / .srt / .md`}
                  rows={12}
                  className="w-full resize-y rounded-xl bg-transparent px-4 py-3 text-sm text-night-700 placeholder:text-graphite outline-none dark:text-stone"
                />
                <div className="flex items-center justify-between border-t border-stone-100 px-3 py-2 text-[11px] text-graphite dark:border-night-700">
                  <span>{rawText.length.toLocaleString()} caracteres</span>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1 text-night hover:underline dark:text-signal"
                  >
                    <Upload className="h-3 w-3" /> Subir archivo
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,.md,.vtt,.srt,.log,text/*"
                    className="hidden"
                    onChange={e => e.target.files?.[0] && readFile(e.target.files[0])}
                  />
                </div>
              </div>

              <button
                onClick={handleParse}
                disabled={parse.isPending || rawText.trim().length < 20}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50"
              >
                {parse.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {parse.isPending ? 'Analizando con AI…' : 'Detectar action items'}
              </button>
            </div>
          ) : (
            <PreviewList
              drafts={drafts}
              keepFlags={keepFlags}
              projects={projects}
              members={members}
              defaultProjectId={defaultProject}
              onUpdate={updateDraft}
              onRemove={removeDraft}
              onToggle={toggleKeep}
            />
          )}
        </div>

        {/* Footer */}
        {hasPreview && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-stone-100 bg-mist px-5 py-3 dark:border-night-700 dark:bg-night-700/40">
            <button
              onClick={() => { setDrafts([]); setKeepFlags([]) }}
              className="rounded-md px-3 py-1.5 text-xs text-graphite hover:bg-stone dark:text-stone dark:hover:bg-ink-body"
            >
              ← Volver a pegar
            </button>
            <span className="text-xs text-graphite">
              {selectedCount} de {drafts.length} seleccionada{drafts.length === 1 ? '' : 's'}
            </span>
            <button
              onClick={handleCreate}
              disabled={bulkCreate.isPending || selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white shadow hover:bg-success active:scale-[0.98] disabled:opacity-50"
            >
              {bulkCreate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {bulkCreate.isPending ? 'Creando…' : `Crear ${selectedCount} tarea${selectedCount === 1 ? '' : 's'}`}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

// ── Preview list ─────────────────────────────────────────────────────────

function PreviewList({
  drafts, keepFlags, projects, members, defaultProjectId,
  onUpdate, onRemove, onToggle,
}: {
  drafts: DraftTask[]
  keepFlags: boolean[]
  projects: ProjectOpt[]
  members: MemberOpt[]
  defaultProjectId: string
  onUpdate: (i: number, patch: Partial<DraftTask>) => void
  onRemove: (i: number) => void
  onToggle: (i: number) => void
}) {
  return (
    <ul className="space-y-2">
      {drafts.map((d, i) => {
        const keep = keepFlags[i]
        const needsProject = !d.project_id && !defaultProjectId
        const confidenceColor =
          d.confidence === 'high'   ? 'bg-success-wash text-success dark:bg-success/40 dark:text-success/50' :
          d.confidence === 'medium' ? 'bg-signal-wash text-signal-ink dark:bg-signal/40 dark:text-signal/50' :
                                       'bg-stone-100 text-graphite dark:bg-night-700 dark:text-graphite'
        return (
          <li
            key={i}
            className={`rounded-xl border p-3 transition ${
              keep
                ? 'border-stone bg-white dark:border-ink-body dark:bg-night'
                : 'border-stone bg-mist opacity-60 dark:border-night-700 dark:bg-night-700/40'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={keep}
                onChange={() => onToggle(i)}
                className="mt-1.5 h-4 w-4 accent-signal"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  value={d.title}
                  onChange={e => onUpdate(i, { title: e.target.value })}
                  placeholder="Título de la tarea"
                  className="w-full bg-transparent text-sm font-medium text-night outline-none placeholder:text-stone dark:text-stone-100"
                />
                {d.description && (
                  <textarea
                    value={d.description}
                    onChange={e => onUpdate(i, { description: e.target.value })}
                    rows={2}
                    className="w-full resize-none rounded-md bg-mist px-2 py-1 text-xs text-graphite outline-none dark:bg-night-700 dark:text-graphite"
                  />
                )}
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <select
                    value={d.project_id ?? ''}
                    onChange={e => onUpdate(i, { project_id: e.target.value || null })}
                    className={`rounded-md border px-2 py-1 text-[11px] dark:bg-night-700 ${
                      needsProject ? 'border-signal-ink bg-signal-wash dark:border-signal-ink dark:bg-signal/30' : 'border-stone dark:border-ink-body'
                    }`}
                  >
                    <option value="">{needsProject ? '⚠️ Sin proyecto' : 'Sin proyecto'}</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                  </select>
                  <select
                    value={d.assignee_id ?? ''}
                    onChange={e => onUpdate(i, { assignee_id: e.target.value || null })}
                    className="rounded-md border border-stone px-2 py-1 text-[11px] dark:border-ink-body dark:bg-night-700"
                  >
                    <option value="">Sin asignar</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select
                    value={d.priority}
                    onChange={e => onUpdate(i, { priority: e.target.value as DraftTask['priority'] })}
                    className="rounded-md border border-stone px-2 py-1 text-[11px] dark:border-ink-body dark:bg-night-700"
                  >
                    <option value="very_high">Muy alta</option>
                    <option value="high">Alta</option>
                    <option value="medium">Media</option>
                    <option value="low">Baja</option>
                    <option value="very_low">Muy baja</option>
                  </select>
                  <input
                    type="date"
                    value={d.due_date ?? ''}
                    onChange={e => onUpdate(i, { due_date: e.target.value || null })}
                    className="rounded-md border border-stone px-2 py-1 text-[11px] dark:border-ink-body dark:bg-night-700"
                  />
                </div>
                {d.confidence && (
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${confidenceColor}`}>
                    {d.confidence === 'high' && <CheckCircle2 className="h-2.5 w-2.5" />}
                    {d.confidence === 'low' && <AlertCircle className="h-2.5 w-2.5" />}
                    Confianza: {d.confidence}
                  </span>
                )}
              </div>
              <button
                onClick={() => onRemove(i)}
                className="rounded p-1 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
                title="Quitar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
