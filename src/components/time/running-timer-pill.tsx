'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import Link from 'next/link'
import { Pause, Clock } from 'lucide-react'

/**
 * Floating pill that shows the user's currently-running timer no matter
 * what page they're on. Lives in the sidebar's footer area. Stop button
 * works from anywhere.
 */
export function RunningTimerPill() {
  const utils = trpc.useUtils()
  const { data } = trpc.time.current.useQuery(undefined, { refetchInterval: 60_000 })

  const [, force] = useState(0)
  useEffect(() => {
    if (!data) return
    const i = setInterval(() => force(v => v + 1), 1000)
    return () => clearInterval(i)
  }, [data])

  const stop = trpc.time.stop.useMutation({
    onSuccess: () => {
      utils.time.current.invalidate()
      utils.time.listByTask.invalidate()
      utils.time.weeklySummary.invalidate()
    },
  })

  if (!data) return null

  const seconds = Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const elapsed = h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`

  const task = data.task as { id?: string; title?: string; project?: { id: string; code: string; color: string } | null } | null
  const project = task?.project ?? null

  return (
    <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-signal/40 bg-signal-wash px-2 py-1.5 dark:border-signal/60 dark:bg-signal/40">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
      </span>
      <Link
        href={project?.id ? `/dashboard/projects/${project.id}` : '#'}
        className="min-w-0 flex-1"
      >
        <p className="truncate text-[11px] font-semibold text-night dark:text-signal">
          {task?.title ?? 'Timer activo'}
        </p>
        <p className="flex items-center gap-1 text-[10px] text-signal-ink dark:text-signal">
          <Clock className="h-2.5 w-2.5" />
          <span className="font-mono tabular-nums">{elapsed}</span>
          {project && <span className="ml-0.5 opacity-70">· {project.code}</span>}
        </p>
      </Link>
      <button
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="rounded p-1 text-danger hover:bg-danger-wash disabled:opacity-50 dark:hover:bg-danger/60"
        title="Detener timer"
      >
        <Pause className="h-3 w-3" />
      </button>
    </div>
  )
}
