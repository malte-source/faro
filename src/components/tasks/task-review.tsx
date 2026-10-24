'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { ExternalLink, Eye, Check, X, FileText, Save } from 'lucide-react'

interface Props {
  taskId: string
  driveUrl: string | null
  reviewerId: string | null
  reviewState: 'requested' | 'approved' | 'changes_requested' | null
  status: string
}

/**
 * Two combined sections for the task detail panel:
 *   1. Documento — Drive (or any) URL associated with the task (the brief).
 *   2. Revisión — pick a reviewer + workflow buttons
 *      (assignee: "Pedir revisión", reviewer: "Aprobar" / "Pedir cambios").
 */
export function TaskReview({ taskId, driveUrl, reviewerId, reviewState, status }: Props) {
  const utils = trpc.useUtils()
  const { data: me } = trpc.team.me.useQuery()
  const { data: members } = trpc.team.members.useQuery()

  const [draftUrl, setDraftUrl] = useState(driveUrl ?? '')
  const [draftReviewer, setDraftReviewer] = useState(reviewerId ?? '')

  useEffect(() => { setDraftUrl(driveUrl ?? '') }, [driveUrl])
  useEffect(() => { setDraftReviewer(reviewerId ?? '') }, [reviewerId])

  const refetch = () => {
    void Promise.all([utils.tasks.invalidate(), utils.projects.invalidate()])
    utils.tasks.invalidate()
    utils.tasks.myDay.invalidate()
  }
  const update = trpc.tasks.update.useMutation({ onSuccess: refetch })
  const requestReview = trpc.tasks.requestReview.useMutation({ onSuccess: refetch })
  const approve = trpc.tasks.approveReview.useMutation({ onSuccess: refetch })
  const requestChanges = trpc.tasks.requestChanges.useMutation({ onSuccess: refetch })

  const isReviewer = reviewerId && me?.id === reviewerId
  const isAdmin = me?.isAdmin
  const canApprove = (isReviewer || isAdmin) && reviewState === 'requested'

  return (
    <div className="space-y-3">
      {/* Documento */}
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-graphite" />
          <span className="text-xs font-semibold text-graphite dark:text-stone">Documento / Brief</span>
        </div>
        <div className="flex gap-1.5">
          <input
            value={draftUrl}
            onChange={e => setDraftUrl(e.target.value)}
            placeholder="URL del doc / brief / spec (Drive, Notion, lo que sea)"
            className="flex-1 rounded-md border border-stone px-2 py-1 text-xs outline-none focus:border-signal dark:border-ink-body dark:bg-night-700"
          />
          <button
            onClick={() => update.mutate({ id: taskId, driveUrl: draftUrl.trim() || null })}
            disabled={draftUrl === (driveUrl ?? '') || update.isPending}
            className="rounded-md bg-stone-100 px-2 py-1 text-xs text-ink-body hover:bg-stone disabled:opacity-50 dark:bg-ink-body dark:text-stone dark:hover:bg-graphite"
          >
            <Save className="h-3 w-3" />
          </button>
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded-md bg-signal-wash px-2 py-1 text-xs font-medium text-night hover:bg-signal-wash dark:bg-signal/40 dark:text-signal"
            >
              Abrir <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Revisión */}
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-graphite" />
          <span className="text-xs font-semibold text-graphite dark:text-stone">Revisión</span>
          {reviewState === 'requested' && <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">esperando revisión</span>}
          {reviewState === 'approved' && <span className="rounded-full bg-success-wash px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-success dark:bg-success/40 dark:text-success/50">aprobada</span>}
          {reviewState === 'changes_requested' && <span className="rounded-full bg-signal-wash px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-signal-ink dark:bg-signal/40 dark:text-signal/50">cambios pedidos</span>}
        </div>

        {/* Reviewer picker */}
        <div className="flex gap-1.5">
          <select
            value={draftReviewer}
            onChange={e => {
              setDraftReviewer(e.target.value)
              update.mutate({ id: taskId, reviewerId: e.target.value || null })
            }}
            className="flex-1 rounded-md border border-stone bg-white px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
          >
            <option value="">Sin revisor asignado</option>
            {(members ?? []).map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        {/* Workflow actions */}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {reviewState !== 'requested' && reviewerId && status !== 'done' && (
            <button
              onClick={() => requestReview.mutate({ id: taskId })}
              disabled={requestReview.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <Eye className="h-3 w-3" /> Pedir revisión
            </button>
          )}
          {canApprove && (
            <>
              <button
                onClick={() => approve.mutate({ id: taskId })}
                disabled={approve.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-success px-2 py-1 text-[11px] font-semibold text-white hover:bg-success disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Aprobar
              </button>
              <button
                onClick={() => requestChanges.mutate({ id: taskId })}
                disabled={requestChanges.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-signal-ink px-2 py-1 text-[11px] font-semibold text-white hover:bg-signal-ink disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Pedir cambios
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
