'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  Megaphone, Plus, Pencil, Trash2, Sparkles, Loader2, X, Eye, EyeOff,
  TrendingUp, AlertTriangle, AlertOctagon, Minus,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { useEscapeClose } from '@/hooks/use-escape-close'
import { EmptyState } from '@/components/ui/empty-state'
import type { ProjectUpdateSentiment } from '@/types/database'

interface Props { projectId: string }

const SENTIMENT_STYLE: Record<ProjectUpdateSentiment, { color: string; ring: string; icon: React.ReactNode; label: string }> = {
  positive: { color: 'text-success bg-success-wash dark:text-success/50 dark:bg-success/30', ring: 'border-l-success', icon: <TrendingUp className="h-3 w-3" />,    label: 'Avance' },
  neutral:  { color: 'text-graphite bg-mist dark:text-stone dark:bg-night-700/50',          ring: 'border-l-graphite',  icon: <Minus className="h-3 w-3" />,         label: 'Neutral' },
  concern:  { color: 'text-signal-ink bg-signal-wash dark:text-signal/50 dark:bg-signal/30',          ring: 'border-l-signal-ink',  icon: <AlertTriangle className="h-3 w-3" />, label: 'Atención' },
  blocker:  { color: 'text-danger bg-danger-wash dark:text-danger/50 dark:bg-danger/30',              ring: 'border-l-danger',   icon: <AlertOctagon className="h-3 w-3" />,  label: 'Bloqueador' },
}

/**
 * Timeline of project status updates, shown in the Overview tab.
 * Each update has author + date + sentiment + content + share-visibility flag.
 *
 * Updates are surfaced in the public Share link too (filtered by
 * `visible_in_share`) so the client sees the history of progress, not just
 * the static snapshot.
 */
export function ProjectUpdates({ projectId }: Props) {
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const { data, isLoading } = trpc.projectUpdates.list.useQuery({ projectId })
  const utils = trpc.useUtils()

  const remove = trpc.projectUpdates.delete.useMutation({
    onSuccess: () => { toast.success('Update borrado'); utils.projectUpdates.list.invalidate({ projectId }) },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <Megaphone className="h-5 w-5 text-signal-ink" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Updates del proyecto</h3>
          <p className="text-xs text-graphite">
            Newsletter interno + para stakeholders. Lo que marques como visible aparece en el share link público.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" /> Publicar update
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />)}
        </div>
      ) : !data?.length ? (
        <EmptyState
          icon={Megaphone}
          title="Sin updates todavía"
          description="Publica un update para que stakeholders sigan el progreso. El primer post puede contar el contexto inicial del proyecto."
        />
      ) : (
        <ul className="space-y-3">
          {data.map(u => {
            const sentiment = (u.sentiment ?? 'neutral') as ProjectUpdateSentiment
            const style = SENTIMENT_STYLE[sentiment]
            const author = (u as unknown as { author: { id: string; name: string; avatar_url: string | null } | null }).author
            return (
              <li
                key={u.id}
                className={`group rounded-lg border-l-4 bg-mist/40 px-3 py-2.5 transition hover:bg-mist dark:bg-night-700/30 dark:hover:bg-night-700/50 ${style.ring}`}
              >
                <div className="flex items-start gap-2">
                  {author && (
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={author.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">{author.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="font-semibold text-ink-body dark:text-stone">{author?.name ?? 'Anónimo'}</span>
                      <span className="text-graphite">·</span>
                      <span className="text-graphite">{new Date(u.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      {u.sentiment && (
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${style.color}`}>
                          {style.icon}
                          {style.label}
                        </span>
                      )}
                      {!u.visible_in_share && (
                        <span className="inline-flex items-center gap-1 rounded bg-stone px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-graphite dark:bg-ink-body" title="No visible en links públicos">
                          <EyeOff className="h-2.5 w-2.5" /> Interno
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-body dark:text-stone">{u.content}</p>
                  </div>
                  <div className="flex flex-col gap-1 opacity-100 md:opacity-0 transition-opacity md:group-hover:opacity-100">
                    <button
                      onClick={() => setEditing(u.id)}
                      className="rounded p-1 text-graphite hover:bg-stone hover:text-body dark:hover:bg-ink-body"
                      title="Editar"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirmAction({ title: 'Borrar este update', variant: 'destructive' })
                        if (ok) remove.mutate(u.id)
                      }}
                      className="rounded p-1 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
                      title="Borrar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <UpdateEditor
          projectId={projectId}
          updateId={editing === 'new' ? null : editing}
          existing={editing !== 'new' ? data?.find(u => u.id === editing) : undefined}
          onClose={() => { setEditing(null); utils.projectUpdates.list.invalidate({ projectId }) }}
        />
      )}
    </div>
  )
}

// ─── Editor modal ────────────────────────────────────────────────────

interface EditorProps {
  projectId: string
  updateId: string | null
  existing?: {
    id: string
    content: string
    sentiment: ProjectUpdateSentiment | null
    visible_in_share: boolean
  }
  onClose: () => void
}

function UpdateEditor({ projectId, updateId, existing, onClose }: EditorProps) {
  const isNew = updateId === null
  const [content, setContent] = useState(existing?.content ?? '')
  const [sentiment, setSentiment] = useState<ProjectUpdateSentiment | ''>(existing?.sentiment ?? '')
  const [visibleInShare, setVisibleInShare] = useState(existing?.visible_in_share ?? true)
  useEscapeClose(onClose)

  const create = trpc.projectUpdates.create.useMutation({
    onSuccess: () => { toast.success('Update publicado'); onClose() },
    onError: (e) => toast.error('No se pudo publicar', e.message),
  })
  const update = trpc.projectUpdates.update.useMutation({
    onSuccess: () => { toast.success('Update actualizado'); onClose() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })
  const generateDraft = trpc.projectUpdates.generateDraft.useMutation({
    onSuccess: (data) => {
      setContent(data.content)
      setSentiment(data.suggested_sentiment as ProjectUpdateSentiment)
      toast.success('Draft generado', 'Revisa y edita antes de publicar.')
    },
    onError: (e) => toast.error('No se pudo generar', e.message),
  })

  function save() {
    if (!content.trim()) { toast.warning('Falta el contenido del update'); return }
    const payload = { content: content.trim(), sentiment: sentiment || undefined, visibleInShare }
    if (isNew) create.mutate({ projectId, ...payload })
    else update.mutate({
      id: updateId!,
      content: content.trim(),
      sentiment: sentiment || null,
      visibleInShare,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 animate-in fade-in md:items-center md:p-4" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[26px] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl animate-in slide-in-from-bottom dark:bg-night md:rounded-2xl md:pb-5 md:zoom-in-95 md:slide-in-from-bottom-0" onClick={e => e.stopPropagation()}>
        <span className="mx-auto -mt-2 mb-3 block h-1 w-10 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-wash dark:bg-signal/40">
              <Megaphone className="h-4 w-4 text-signal-ink" />
            </span>
            <h2 className="text-base font-semibold">{isNew ? 'Publicar update' : 'Editar update'}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* AI draft generator */}
          {isNew && (
            <button
              onClick={() => generateDraft.mutate({ projectId })}
              disabled={generateDraft.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone bg-signal-wash/60 px-3 py-2 text-xs font-medium text-night hover:bg-signal-wash disabled:opacity-50 dark:border-signal/40 dark:bg-signal/30 dark:text-signal"
            >
              {generateDraft.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generateDraft.isPending ? 'Generando draft con AI…' : 'Generar draft con AI (basado en actividad reciente)'}
            </button>
          )}

          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={8}
            placeholder="Esta semana avanzamos en…, surgió…, próximos pasos…"
            className="w-full resize-y rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-graphite dark:text-stone">Tono</label>
              <select
                value={sentiment}
                onChange={e => setSentiment(e.target.value as ProjectUpdateSentiment | '')}
                className="mt-1 w-full rounded-lg border border-stone px-3 py-1.5 text-sm dark:border-ink-body dark:bg-night-700"
              >
                <option value="">Sin tono</option>
                <option value="positive">📈 Avance</option>
                <option value="neutral">— Neutral</option>
                <option value="concern">⚠️ Atención</option>
                <option value="blocker">🚫 Bloqueador</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-stone px-3 py-1.5 text-xs dark:border-ink-body">
                <input
                  type="checkbox"
                  checked={visibleInShare}
                  onChange={e => setVisibleInShare(e.target.checked)}
                  className="h-3.5 w-3.5 accent-signal"
                />
                {visibleInShare ? <Eye className="h-3 w-3 text-signal-ink" /> : <EyeOff className="h-3 w-3 text-graphite" />}
                Visible en share público
              </label>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-night-700">
          <button onClick={onClose} className="rounded-lg border border-stone px-3 py-1.5 text-xs dark:border-ink-body">Cancelar</button>
          <button
            onClick={save}
            disabled={create.isPending || update.isPending}
            className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            {create.isPending || update.isPending ? 'Guardando…' : (isNew ? 'Publicar' : 'Guardar')}
          </button>
        </div>
      </div>
    </div>
  )
}
