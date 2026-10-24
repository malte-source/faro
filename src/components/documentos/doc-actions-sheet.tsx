'use client'

import { AlertTriangle, CheckCircle2, Download, FileWarning, History, MessageSquareWarning, Printer, RotateCcw, Send, Sparkles, Trash2 } from 'lucide-react'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'

type Status = 'borrador' | 'en_revision' | 'aprobado' | 'obsoleto'

/**
 * Phone action menu of a document (iOS action sheet): the workflow steps that
 * apply to its current state, Faro's helpers and the document tools. On desktop
 * these live in the toolbar row instead.
 */
export function DocActionsSheet({
  open, onClose, status, canEdit, canManage, canReview, busy, hasBody,
  onSendReview, onApprove, onRequestChanges, onObsolete, onReopen,
  onImprove, onAiReview, onVersions, onDownload, onPrint, onDelete,
}: {
  open: boolean
  onClose: () => void
  status: Status
  canEdit: boolean
  canManage: boolean
  canReview: boolean
  busy: boolean
  hasBody: boolean
  onSendReview: () => void
  onApprove: () => void
  onRequestChanges: () => void
  onObsolete: () => void
  onReopen: () => void
  onImprove: () => void
  onAiReview: () => void
  onVersions: () => void
  onDownload: () => void
  onPrint: () => void
  onDelete: () => void
}) {
  const run = (fn: () => void) => () => { onClose(); fn() }
  const workflow: React.ReactNode[] = []
  if (status === 'borrador') {
    workflow.push(<ListRow key="send" disabled={busy} onClick={run(onSendReview)} leading={<IconTile tone="night"><Send /></IconTile>} title="Enviar a revisión" subtitle="Elige quién lo revisa" />)
  }
  if (status === 'en_revision' && canReview) {
    workflow.push(
      <ListRow key="approve" disabled={busy} onClick={run(onApprove)} leading={<IconTile tone="success"><CheckCircle2 /></IconTile>} title="Aprobar" />,
      <ListRow key="changes" disabled={busy} onClick={run(onRequestChanges)} leading={<IconTile tone="signal"><MessageSquareWarning /></IconTile>} title="Pedir cambios" subtitle="Vuelve a borrador con tu comentario" />,
    )
  }
  if (status === 'aprobado' && canManage) {
    workflow.push(<ListRow key="obs" disabled={busy} onClick={run(onObsolete)} leading={<IconTile tone="neutral"><FileWarning /></IconTile>} title="Marcar obsoleto" subtitle="Queda de solo lectura" />)
  }
  if (status === 'obsoleto' && canManage) {
    workflow.push(<ListRow key="reopen" disabled={busy} onClick={run(onReopen)} leading={<IconTile tone="neutral"><RotateCcw /></IconTile>} title="Reabrir como borrador" />)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Acciones">
      <div className="space-y-5 pb-2 pt-2">
        {workflow.length > 0 && <InsetGroup label="Flujo">{workflow}</InsetGroup>}

        <InsetGroup label="Faro">
          <ListRow disabled={!canEdit} onClick={run(onImprove)} leading={<IconTile tone="signal"><Sparkles /></IconTile>} title="Mejorar con IA" subtitle="Reescribe según tu instrucción" />
          <ListRow disabled={!hasBody} onClick={run(onAiReview)} leading={<IconTile tone="neutral"><AlertTriangle /></IconTile>} title="Revisar con IA" subtitle="Busca huecos y ambigüedades" />
        </InsetGroup>

        <InsetGroup label="Documento">
          <ListRow onClick={run(onVersions)} leading={<IconTile tone="neutral"><History /></IconTile>} title="Versiones" />
          <ListRow onClick={run(onDownload)} leading={<IconTile tone="neutral"><Download /></IconTile>} title="Descargar .md" />
          <ListRow onClick={run(onPrint)} leading={<IconTile tone="neutral"><Printer /></IconTile>} title="Imprimir" />
        </InsetGroup>

        {canManage && (
          <InsetGroup>
            <ListRow disabled={busy} onClick={run(onDelete)} leading={<IconTile tone="danger"><Trash2 /></IconTile>} title="Eliminar documento" destructive />
          </InsetGroup>
        )}
      </div>
    </BottomSheet>
  )
}
