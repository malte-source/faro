'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import {
  CheckCircle2, Edit3, Trash2, Plus, AlertCircle, MessageSquare, Activity,
} from 'lucide-react'

/**
 * Org-wide activity feed. Reads `audit_log` and renders a unified timeline
 * of every project/task change, who did it, and when. Polls every 30 s
 * for near-realtime updates.
 *
 * Enrichment: project IDs in entity_id are resolved against projects.list
 * (already cached client-side) to display code + name instead of raw UUID.
 */

const ACTION_ICONS: Record<string, { icon: typeof Plus; tone: string; label: string }> = {
  created: { icon: Plus, tone: 'text-success bg-success-wash dark:bg-success/40', label: 'creó' },
  updated: { icon: Edit3, tone: 'text-signal-ink bg-signal-wash dark:bg-signal/40', label: 'actualizó' },
  deleted: { icon: Trash2, tone: 'text-danger bg-danger-wash dark:bg-danger/40', label: 'eliminó' },
  commented: { icon: MessageSquare, tone: 'text-signal-ink bg-signal-wash dark:bg-signal/40', label: 'comentó' },
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'recién'
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `hace ${d}d`
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short' })
}

const FIELD_LABELS: Record<string, string> = {
  status: 'estado',
  priority: 'prioridad',
  kanban_stage: 'etapa',
  progress_pct: 'progreso',
  end_date: 'fecha de fin',
  start_date: 'fecha de inicio',
  name: 'nombre',
}

export function ActivityFeed() {
  const { data, isLoading, isFetching } = trpc.audit.byOrg.useQuery(
    { limit: 100 },
    { refetchInterval: 30_000 }, // poll every 30 s for near-realtime
  )
  const { data: projects } = trpc.projects.list.useQuery()

  const projectMap = useMemo(() => {
    const m = new Map<string, { code: string; name: string; color: string }>()
    for (const p of projects ?? []) m.set(p.id, { code: p.code, name: p.name, color: p.color })
    return m
  }, [projects])

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />
        ))}
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="rounded-xl border border-dashed border-stone bg-white p-12 text-center dark:border-ink-body dark:bg-night">
        <Activity className="mx-auto h-8 w-8 text-stone" />
        <p className="mt-3 text-sm text-graphite">
          Sin actividad reciente. Cuando crees o modifiques proyectos y tareas, vas a verlo aquí.
        </p>
      </div>
    )
  }

  // Group by day
  const groups = data.reduce<Record<string, typeof data>>((acc, ev) => {
    const key = new Date(ev.changed_at).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
    if (!acc[key]) acc[key] = []
    acc[key].push(ev)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {isFetching && (
        <div className="text-[10px] uppercase tracking-wider text-signal-ink">Actualizando…</div>
      )}

      {Object.entries(groups).map(([day, events]) => (
        <section key={day}>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">{day}</h3>
          <ul className="overflow-hidden rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
            {events.map((ev, i) => {
              const meta = ACTION_ICONS[ev.action] ?? ACTION_ICONS.updated
              const Icon = meta.icon
              const author = (ev.user as { id?: string; name?: string; avatar_url?: string | null } | null)
              const proj = ev.entity_type === 'project' ? projectMap.get(ev.entity_id) : null

              const subject = (() => {
                if (ev.entity_type === 'project') {
                  return proj ? `${proj.code} · ${proj.name}` : 'un proyecto'
                }
                if (ev.entity_type === 'task') return 'una tarea'
                if (ev.entity_type === 'comment') return 'un comentario'
                return ev.entity_type
              })()

              const fieldText = ev.field_changed
                ? ` ${FIELD_LABELS[ev.field_changed] ?? ev.field_changed}`
                : ''
              const valueText = ev.new_value
                ? ` → ${ev.new_value}`
                : ''

              const href = ev.entity_type === 'project' ? `/dashboard/projects/${ev.entity_id}` : null

              return (
                <li
                  key={ev.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-2.5',
                    i > 0 && 'border-t border-stone-100 dark:border-night-700',
                  )}
                >
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', meta.tone)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-night-700 dark:text-stone">
                      <span className="font-semibold">{author?.name ?? 'Alguien'}</span>{' '}
                      <span className="text-graphite">{meta.label}{fieldText} en</span>{' '}
                      {href ? (
                        <Link href={href} className="font-medium text-night hover:underline dark:text-signal">{subject}</Link>
                      ) : (
                        <span className="font-medium">{subject}</span>
                      )}
                      {valueText && (
                        <span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-graphite dark:bg-night-700 dark:text-stone">
                          {valueText.slice(3)}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[10px] text-graphite">{fmtRelative(ev.changed_at)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
