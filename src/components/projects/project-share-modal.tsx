'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  Share2, X, Copy, ExternalLink, Trash2, Plus, Clock, Eye,
} from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { useEscapeClose } from '@/hooks/use-escape-close'

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
}

/**
 * Project share modal — creates / manages read-only public links to this project.
 *
 * The token is the only secret. URLs look like:
 *   https://app/share/{token}
 *
 * Users can:
 *   - Create a new link (with optional label + expiration)
 *   - Copy link to clipboard
 *   - See last-accessed timestamp + access count
 *   - Revoke a link (kills the URL immediately)
 */
export function ProjectShareModal({ projectId, projectName, onClose }: Props) {
  const utils = trpc.useUtils()
  useEscapeClose(onClose)

  const [label, setLabel] = useState('')
  const [expiresInDays, setExpiresInDays] = useState<string>('0')  // 0 = no exp

  const { data: links, isLoading } = trpc.share.list.useQuery({ entityType: 'project', entityId: projectId })

  const create = trpc.share.create.useMutation({
    onSuccess: () => {
      toast.success('Link creado')
      setLabel('')
      utils.share.list.invalidate()
    },
    onError: (e) => toast.error('No se pudo crear', e.message),
  })
  const revoke = trpc.share.revoke.useMutation({
    onSuccess: () => { toast.success('Link revocado'); utils.share.list.invalidate() },
    onError: (e) => toast.error('No se pudo revocar', e.message),
  })

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  function handleCreate() {
    const days = parseInt(expiresInDays, 10)
    create.mutate({
      entityType: 'project',
      entityId: projectId,
      label: label.trim() || undefined,
      expiresInDays: days > 0 ? days : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-night animate-in zoom-in-95 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-night-700">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-wash dark:bg-signal/40">
              <Share2 className="h-4 w-4 text-signal-ink" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-night dark:text-stone-100">Compartir proyecto</h2>
              <p className="text-[11px] text-graphite">{projectName}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Create new link */}
          <section className="rounded-xl border border-stone bg-signal-wash/40 p-4 dark:border-signal/40 dark:bg-signal/20">
            <h3 className="text-sm font-semibold text-night dark:text-signal mb-2 flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nuevo link compartible
            </h3>
            <p className="text-xs text-night/80 dark:text-signal/70">
              Quien tenga el link va a poder ver el proyecto sin login. <strong>Solo lectura</strong> —
              no se exponen comentarios, archivos ni emails del equipo.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-night dark:text-signal">
                  Etiqueta (para ti)
                </label>
                <input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder='"Cliente Andes" o "Reporte mensual"'
                  className="mt-1 w-full rounded-md border border-stone bg-white px-2 py-1.5 text-xs dark:border-ink-body dark:bg-night-700"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-night dark:text-signal">
                  Expira en
                </label>
                <select
                  value={expiresInDays}
                  onChange={e => setExpiresInDays(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone bg-white px-2 py-1.5 text-xs dark:border-ink-body dark:bg-night-700"
                >
                  <option value="0">Nunca</option>
                  <option value="7">7 días</option>
                  <option value="14">14 días</option>
                  <option value="30">30 días</option>
                  <option value="90">90 días</option>
                </select>
              </div>
            </div>
            <button
              onClick={handleCreate}
              disabled={create.isPending}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              <Share2 className="h-3.5 w-3.5" />
              {create.isPending ? 'Creando…' : 'Crear link'}
            </button>
          </section>

          {/* Existing links */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-graphite mb-2">
              Links activos
            </h3>
            {isLoading ? (
              <p className="text-xs text-graphite">Cargando…</p>
            ) : !links?.length ? (
              <p className="rounded-lg bg-mist px-3 py-4 text-center text-xs text-graphite dark:bg-night-700/50">
                Sin links creados todavía.
              </p>
            ) : (
              <ul className="space-y-2">
                {links.map(l => {
                  const url = `${baseUrl}/share/${l.token}`
                  const expired = l.expires_at && new Date(l.expires_at).getTime() < Date.now()
                  return (
                    <li key={l.id} className={`rounded-lg border p-3 ${expired ? 'border-stone bg-mist opacity-60 dark:border-night-700 dark:bg-night-700/40' : 'border-stone bg-white dark:border-ink-body dark:bg-night'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-night dark:text-stone-100">
                            {l.label ?? <span className="text-graphite italic">Sin etiqueta</span>}
                            {expired && <span className="ml-2 rounded bg-stone px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-graphite dark:bg-ink-body">Expirado</span>}
                          </p>
                          <code className="mt-1 block truncate text-[11px] font-mono text-graphite">{url}</code>
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-graphite">
                            <span>Creado {new Date(l.created_at).toLocaleDateString('es-AR')}</span>
                            {l.expires_at && (
                              <span className="inline-flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                Expira {new Date(l.expires_at).toLocaleDateString('es-AR')}
                              </span>
                            )}
                            {l.last_accessed_at && (
                              <span className="inline-flex items-center gap-0.5">
                                <Eye className="h-2.5 w-2.5" />
                                Visto {new Date(l.last_accessed_at).toLocaleString('es-AR')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(url)
                              toast.success('Link copiado')
                            }}
                            className="rounded p-1.5 text-graphite hover:bg-stone-100 hover:text-signal-ink dark:hover:bg-night-700"
                            title="Copiar URL"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded p-1.5 text-graphite hover:bg-stone-100 hover:text-signal-ink dark:hover:bg-night-700"
                            title="Abrir"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <button
                            onClick={async () => {
                              const ok = await confirmAction({
                                title: 'Revocar link',
                                description: 'El link deja de funcionar inmediatamente. Quien lo tenga verá un error 404.',
                                variant: 'destructive',
                                confirmLabel: 'Revocar',
                              })
                              if (ok) revoke.mutate(l.id)
                            }}
                            className="rounded p-1.5 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
                            title="Revocar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
