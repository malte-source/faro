'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NewDocumentDialog } from '@/components/documentos/new-document-dialog'
import type { DocumentKind } from '@/types/database'

/**
 * "Crear documento" from a task: opens the generate dialog with the task's
 * title as the brief and links the resulting document to the task.
 * Mount it in the task detail panel / task row actions.
 */
export function DocumentFromTaskButton({
  taskId,
  title,
  projectId,
  kind = 'politica',
  className,
  compact = false,
}: {
  taskId: string
  title: string
  projectId?: string
  kind?: DocumentKind
  className?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)} title="Crear un documento a partir de esta tarea">
        <FileText className="h-3.5 w-3.5" />
        {!compact && 'Crear documento'}
      </Button>
      <NewDocumentDialog
        open={open}
        onClose={() => setOpen(false)}
        taskId={taskId}
        projectId={projectId}
        defaultKind={kind}
        defaultTitle={title}
        defaultBrief={`Tarea de origen: ${title}`}
        defaultMode="ai"
      />
    </>
  )
}
