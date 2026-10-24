'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Users, Calendar, X, CheckCircle2, ExternalLink, AlertTriangle, Search } from 'lucide-react'
import { useEscapeClose } from '@/hooks/use-escape-close'

interface Props {
  /** Optional project to pre-select members from and link the event back to */
  projectId?: string
  /** Optional pre-fill for the meeting title */
  defaultTitle?: string
  onClose: () => void
}

/**
 * "Schedule meeting" modal:
 *   1. User picks attendees (org-wide list, with project members pre-selected if given).
 *   2. Picks duration + window.
 *   3. FARO calls freeBusy across all attendees and shows top common free slots.
 *   4. User clicks a slot → event created in Calendar with all attendees invited
 *      (Google sends emails automatically via sendUpdates=all).
 */
export function MeetingScheduler({ projectId, defaultTitle = '', onClose }: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [duration, setDuration] = useState(30)
  const [windowDays, setWindowDays] = useState(7)
  const [booked, setBooked] = useState<{ htmlLink: string } | null>(null)

  // Team list — when a projectId is given, prefer members of that project.
  const { data: teamData } = trpc.team.members.useQuery()
  const { data: projectData } = trpc.projects.byId.useQuery(projectId!, { enabled: !!projectId })

  // Auto-select project members when the project loads.
  useEffect(() => {
    if (!projectData) return
    const members = (projectData.members ?? []) as Array<{ user: { id: string } | null }>
    const ids = members.map(m => m.user?.id).filter((x): x is string => !!x)
    setSelected(new Set(ids))
  }, [projectData])

  const search = trpc.calendar.findCommonSlots.useMutation()
  const schedule = trpc.calendar.scheduleMeeting.useMutation({ onSuccess: r => setBooked({ htmlLink: r.htmlLink }) })

  const run = () => {
    if (selected.size === 0 || !title.trim()) return
    search.mutate({ userIds: Array.from(selected), durationMinutes: duration, windowDays })
  }

  useEscapeClose(onClose)

  const book = (slot: { start: string; end: string }) => {
    schedule.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      start: slot.start, end: slot.end,
      attendeeUserIds: Array.from(selected),
      projectId,
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:items-center md:p-4" onClick={onClose}>
      <div className="max-h-[92dvh] md:max-h-[90vh] w-full max-w-xl md:max-w-3xl overflow-y-auto rounded-t-[26px] rounded-b-none md:rounded-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5 shadow-2xl dark:bg-night" onClick={e => e.stopPropagation()}><span className="mx-auto -mt-2 mb-3 block h-1 w-10 shrink-0 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-night dark:text-stone-100">
            <Calendar className="h-4 w-4 text-signal-ink" /> Schedulear reunión
          </h2>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700"><X className="h-4 w-4" /></button>
        </div>

        {booked ? (
          <div className="rounded-lg border border-success/30 bg-success-wash p-6 text-center dark:border-success/40 dark:bg-success/20">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <p className="mt-2 text-base font-semibold text-success dark:text-success/30">¡Reunión agendada!</p>
            <p className="mt-1 text-xs text-success dark:text-success/50">Google envió las invitaciones automáticamente.</p>
            <a href={booked.htmlLink} target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-success">
              Abrir en Calendar <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Título de la reunión (ej: Kickoff WEB-2026)"
                className="w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              />
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Descripción / agenda (opcional)"
                rows={2}
                className="w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              />

              {/* Attendees */}
              <div className="rounded-lg border border-stone p-3 dark:border-ink-body">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-graphite">
                  <Users className="h-3 w-3" /> Asistentes ({selected.size})
                </p>
                <div className="max-h-40 overflow-y-auto">
                  <ul className="grid grid-cols-2 gap-1">
                    {(teamData ?? []).filter(u => !!u.email).map(u => {
                      const isSel = selected.has(u.id)
                      return (
                        <li key={u.id}>
                          <button
                            onClick={() => setSelected(s => {
                              const next = new Set(s)
                              if (next.has(u.id)) next.delete(u.id); else next.add(u.id)
                              return next
                            })}
                            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition ${isSel ? 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal' : 'hover:bg-stone-100 dark:hover:bg-night-700'}`}
                          >
                            <input type="checkbox" checked={isSel} readOnly className="pointer-events-none" />
                            <span className="truncate">{u.name ?? u.email}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">
                  <span className="text-graphite dark:text-stone">Duración</span>
                  <select value={duration} onChange={e => setDuration(parseInt(e.target.value))}
                    className="mt-1 w-full rounded border border-stone px-2 py-1.5 text-sm dark:border-ink-body dark:bg-night-700">
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>1 hora</option>
                    <option value={90}>1h 30min</option>
                    <option value={120}>2 horas</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="text-graphite dark:text-stone">Ventana de búsqueda</span>
                  <select value={windowDays} onChange={e => setWindowDays(parseInt(e.target.value))}
                    className="mt-1 w-full rounded border border-stone px-2 py-1.5 text-sm dark:border-ink-body dark:bg-night-700">
                    <option value={3}>3 días</option>
                    <option value={7}>1 semana</option>
                    <option value={14}>2 semanas</option>
                  </select>
                </label>
              </div>

              <button
                onClick={run}
                disabled={search.isPending || selected.size === 0 || !title.trim()}
                className="w-full rounded-lg bg-night px-3 py-2 text-sm font-semibold text-white hover:bg-night-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
              >
                <Search className="h-3.5 w-3.5" />
                {search.isPending ? 'Buscando huecos comunes…' : 'Buscar huecos donde TODOS estén libres'}
              </button>

              {search.isError && (
                <p className="rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger dark:bg-danger/30 dark:text-danger/50">{search.error.message}</p>
              )}

              {search.data && (
                <div>
                  {search.data.calendarErrors.length > 0 && (
                    <p className="mb-2 inline-flex items-start gap-1 rounded-lg bg-signal-wash px-3 py-2 text-[11px] text-signal-ink dark:bg-signal/30 dark:text-signal/30">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      No se pudo leer la disponibilidad de {search.data.calendarErrors.length} agenda(s) — se asumieron libres.
                    </p>
                  )}
                  {search.data.slots.length === 0 ? (
                    <p className="rounded-lg bg-mist px-3 py-2 text-xs text-graphite dark:bg-night-700">
                      Sin huecos comunes en la ventana. Amplía la ventana o reduce la duración.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {search.data.slots.map(s => (
                        <li key={s.start} className="flex items-center justify-between rounded-lg border border-stone px-3 py-2 dark:border-ink-body">
                          <div>
                            <p className="text-sm font-medium text-night-700 dark:text-stone">
                              {s.dayLabel} {formatTime(s.start)} – {formatTime(s.end)}
                            </p>
                            <p className="text-[10px] text-graphite">
                              {new Date(s.start).toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}
                            </p>
                          </div>
                          <button
                            onClick={() => book(s)}
                            disabled={schedule.isPending}
                            className="rounded-md bg-success px-2.5 py-1 text-xs font-semibold text-white hover:bg-success disabled:opacity-50"
                          >
                            Agendar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}
