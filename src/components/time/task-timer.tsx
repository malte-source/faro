'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Play, Pause, Plus, Trash2, Clock } from 'lucide-react'

interface Props { taskId: string }

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

function fmtElapsed(startISO: string): string {
  const seconds = Math.floor((Date.now() - new Date(startISO).getTime()) / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Start/stop timer button + history of time entries for a task.
 * Shown in the task detail panel.
 */
export function TaskTimer({ taskId }: Props) {
  const utils = trpc.useUtils()
  const { data: current } = trpc.time.current.useQuery(undefined, { refetchInterval: 30_000 })
  const { data: entries } = trpc.time.listByTask.useQuery(taskId)

  const [adding, setAdding] = useState(false)
  const [manualMinutes, setManualMinutes] = useState('')
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().split('T')[0])
  const [manualNotes, setManualNotes] = useState('')

  // Tick local elapsed display every second when this task is the active one
  const isThisTaskRunning = current?.task_id === taskId
  const [, force] = useState(0)
  useEffect(() => {
    if (!isThisTaskRunning) return
    const i = setInterval(() => force(v => v + 1), 1000)
    return () => clearInterval(i)
  }, [isThisTaskRunning])

  const refetch = () => {
    utils.time.current.invalidate()
    utils.time.listByTask.invalidate(taskId)
    utils.time.weeklySummary.invalidate()
  }

  const start = trpc.time.start.useMutation({ onSuccess: refetch })
  const stop = trpc.time.stop.useMutation({ onSuccess: refetch })
  const addManual = trpc.time.addManual.useMutation({
    onSuccess: () => {
      refetch()
      setAdding(false)
      setManualMinutes('')
      setManualNotes('')
    },
  })
  const remove = trpc.time.delete.useMutation({ onSuccess: refetch })

  const totalMinutes = (entries ?? []).reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-graphite" />
        <span className="text-xs font-semibold text-graphite dark:text-stone">
          Tiempo {totalMinutes > 0 && `· ${fmtMinutes(totalMinutes)}`}
        </span>
      </div>

      {/* Start/Stop control */}
      <div className="flex items-center gap-2">
        {isThisTaskRunning && current ? (
          <button
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-danger px-3 py-2 text-xs font-semibold text-white hover:bg-danger disabled:opacity-50"
          >
            <Pause className="h-3.5 w-3.5" />
            <span className="tabular-nums">{fmtElapsed(current.started_at)}</span>
            <span className="opacity-70">· Detener</span>
          </button>
        ) : (
          <button
            onClick={() => start.mutate({ taskId })}
            disabled={start.isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background hover:bg-night-700 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Iniciar timer
          </button>
        )}
        <button
          onClick={() => setAdding(v => !v)}
          className="rounded-lg border border-stone px-3 py-2 text-xs font-medium text-graphite hover:bg-mist dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
          title="Agregar manualmente"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Manual entry form */}
      {adding && (
        <div className="space-y-1.5 rounded-lg border border-stone bg-mist p-2 dark:border-ink-body dark:bg-night-700">
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              className="rounded border border-stone bg-white px-2 py-1 text-xs dark:border-graphite dark:bg-night"
            />
            <input
              type="number"
              inputMode="numeric"
              value={manualMinutes}
              onChange={(e) => setManualMinutes(e.target.value)}
              placeholder="minutos"
              min={1}
              className="rounded border border-stone bg-white px-2 py-1 text-xs dark:border-graphite dark:bg-night"
            />
          </div>
          <input
            value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
            placeholder="Notas (opcional)"
            className="w-full rounded border border-stone bg-white px-2 py-1 text-xs dark:border-graphite dark:bg-night"
          />
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setAdding(false)}
              className="rounded px-2 py-1 text-[11px] text-graphite hover:bg-stone-100 dark:hover:bg-ink-body"
            >Cancelar</button>
            <button
              onClick={() => addManual.mutate({
                taskId,
                date: manualDate,
                durationMinutes: parseInt(manualMinutes || '0', 10),
                notes: manualNotes || undefined,
              })}
              disabled={!manualMinutes || addManual.isPending}
              className="rounded bg-foreground px-2 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
            >Agregar</button>
          </div>
        </div>
      )}

      {/* History */}
      {entries && entries.length > 0 && (
        <ul className="space-y-0.5">
          {entries.slice(0, 5).map(e => {
            const user = e.user as { id?: string; name?: string } | null
            const date = new Date(e.started_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })
            const isMine = user?.id === undefined // can't easily get me here; just allow delete on any own entry server-side
            return (
              <li key={e.id} className="group flex items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-mist dark:hover:bg-night-700">
                <span className="font-mono tabular-nums text-ink-body dark:text-stone">
                  {e.duration_minutes ? fmtMinutes(e.duration_minutes) : '—'}
                </span>
                <span className="text-graphite">·</span>
                <span className="truncate text-graphite">{user?.name ?? '?'}</span>
                <span className="text-graphite">·</span>
                <span className="text-graphite">{date}</span>
                {e.source === 'manual' && (
                  <span className="rounded bg-stone-100 px-1 text-[9px] text-graphite dark:bg-ink-body">manual</span>
                )}
                <button
                  onClick={() => remove.mutate(e.id)}
                  className="ml-auto rounded p-0.5 text-stone opacity-100 md:opacity-0 hover:text-danger md:group-hover:opacity-100"
                  title="Eliminar (solo propias)"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            )
          })}
          {entries.length > 5 && (
            <li className="text-[10px] text-graphite">+ {entries.length - 5} más</li>
          )}
        </ul>
      )}
    </div>
  )
}
