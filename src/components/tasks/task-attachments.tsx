'use client'

import { useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Paperclip, Upload, ExternalLink, Trash2, FileText, AlertTriangle } from 'lucide-react'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'

interface Props { taskId: string }

/**
 * Drop-zone + list of files attached to a task.
 *
 * Upload flow (avoids proxying file bytes through tRPC):
 *   1. prepareUpload → server creates the project folder if missing,
 *      returns folderId + the user's access_token
 *   2. multipart upload directly to Drive (POST to upload.googleapis.com)
 *   3. register → server inserts the metadata row
 *
 * If the user's access token expired the NextAuth jwt refresh kicks in
 * before this mutation runs; if THAT fails, prepareUpload returns
 * UNAUTHORIZED and we ask the user to re-sign-in.
 */
export function TaskAttachments({ taskId }: Props) {
  const utils = trpc.useUtils()
  const { data: attachments, isLoading } = trpc.attachments.listByTask.useQuery(taskId)
  const inputRef = useRef<HTMLInputElement>(null)

  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const prepare = trpc.attachments.prepareUpload.useMutation()
  const register = trpc.attachments.register.useMutation({
    onSuccess: () => utils.attachments.listByTask.invalidate(taskId),
  })
  const remove = trpc.attachments.delete.useMutation({
    onSuccess: () => utils.attachments.listByTask.invalidate(taskId),
  })

  async function uploadFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const { folderId, accessToken } = await prepare.mutateAsync({ taskId })

      // Drive multipart upload
      const metadata = {
        name: file.name,
        mimeType: file.type || undefined,
        parents: [folderId],
      }
      const boundary = '-------faro_' + Date.now()
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) + '\r\n' +
        `--${boundary}\r\n` +
        `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`

      const closing = `\r\n--${boundary}--`
      const blob = new Blob([body, file, closing], { type: `multipart/related; boundary=${boundary}` })

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,iconLink',
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: blob },
      )
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Drive upload ${res.status}: ${t.slice(0, 200)}`)
      }
      const created = await res.json() as {
        id: string; name: string; mimeType?: string; size?: string
        webViewLink: string; iconLink?: string
      }
      await register.mutateAsync({
        taskId,
        driveFileId: created.id,
        fileName: created.name,
        mimeType: created.mimeType,
        sizeBytes: created.size ? parseInt(created.size, 10) : undefined,
        webViewLink: created.webViewLink,
        iconLink: created.iconLink,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setUploading(false)
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    Array.from(files).forEach(uploadFile)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Paperclip className="h-3.5 w-3.5 text-graphite" />
        <span className="text-xs font-semibold text-graphite dark:text-stone">
          Adjuntos {attachments && attachments.length > 0 && `(${attachments.length})`}
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-xs transition ${
          dragging
            ? 'border-signal bg-signal-wash dark:bg-signal/40'
            : 'border-stone text-graphite hover:border-signal/50 hover:bg-mist dark:border-ink-body dark:hover:bg-night-700'
        }`}
      >
        <Upload className={`h-3.5 w-3.5 ${uploading ? 'animate-pulse' : ''}`} />
        <span>{uploading ? 'Subiendo a Drive…' : 'Arrastra un archivo o haz clic para subir'}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {error && (
        <div className="flex items-start gap-1.5 rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger dark:bg-danger/40 dark:text-danger/50">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-1.5">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-stone-100 dark:bg-night-700" />
          ))}
        </div>
      ) : attachments && attachments.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone dark:divide-night-700 dark:border-ink-body">
          {attachments.map(a => (
            <li key={a.id} className="group flex items-center gap-2 bg-white px-3 py-2 transition hover:bg-mist dark:bg-night dark:hover:bg-night-700">
              {a.icon_link ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.icon_link} alt="" className="h-4 w-4 shrink-0" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-graphite" />
              )}
              <a
                href={a.web_view_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-xs text-ink-body hover:text-night dark:text-stone dark:hover:text-signal"
              >
                {a.file_name}
              </a>
              <a
                href={a.web_view_link}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded p-1 text-stone hover:bg-stone-100 hover:text-graphite dark:hover:bg-night-700"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
              <button
                onClick={async () => {
                  const ok = await confirmAction({ title: `Quitar "${a.file_name}"`, description: 'El archivo queda en Drive, solo se desvincula de esta tarea.', variant: 'warning' })
                  if (ok) remove.mutate(a.id)
                }}
                className="rounded p-1 text-stone opacity-100 md:opacity-0 transition hover:bg-danger-wash hover:text-danger md:group-hover:opacity-100 dark:hover:bg-danger/40"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
