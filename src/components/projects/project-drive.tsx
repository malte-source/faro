'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { FolderPlus, Link as LinkIcon, ExternalLink, RefreshCw, FileText, Unlink } from 'lucide-react'

interface Props { projectId: string }

/**
 * "Drive" tab inside a project: lets the user create a new linked folder
 * in their Google Drive, paste an existing folder URL, view contents,
 * or unlink the folder.
 *
 * Folder URL parsing accepts the standard share URL forms:
 *   https://drive.google.com/drive/folders/<id>
 *   https://drive.google.com/drive/folders/<id>?usp=...
 */
function extractFolderId(input: string): string | null {
  // Already an ID?
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim()
  const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function fmtBytes(s?: string): string {
  if (!s) return ''
  const n = parseInt(s, 10)
  if (isNaN(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function ProjectDrive({ projectId }: Props) {
  const [linkInput, setLinkInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const utils = trpc.useUtils()

  const filesQuery = trpc.projects.driveFiles.useQuery({ projectId })

  const createFolder = trpc.projects.createDriveFolder.useMutation({
    onSuccess: () => utils.projects.driveFiles.invalidate({ projectId }),
    onError: (e) => setError(e.message),
  })

  const linkFolder = trpc.projects.linkDriveFolder.useMutation({
    onSuccess: () => {
      utils.projects.driveFiles.invalidate({ projectId })
      setLinkInput('')
      setError(null)
    },
    onError: (e) => setError(e.message),
  })

  const unlink = trpc.projects.unlinkDriveFolder.useMutation({
    onSuccess: () => utils.projects.driveFiles.invalidate({ projectId }),
  })

  function handleLink() {
    setError(null)
    const folderId = extractFolderId(linkInput)
    if (!folderId) {
      setError('Pega la URL de una carpeta de Drive o el ID directo.')
      return
    }
    linkFolder.mutate({ projectId, folderId })
  }

  const data = filesQuery.data
  const folder = data?.folder
  const files = data?.files ?? []
  const linked = !!folder

  // ── Not yet linked ──────────────────────────────────────────────────
  if (!filesQuery.isLoading && !linked) {
    return (
      <div className="rounded-xl border border-dashed border-stone bg-white p-6 dark:border-ink-body dark:bg-night">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-signal-wash dark:bg-signal/40">
            <FolderPlus className="h-6 w-6 text-signal-ink" />
          </div>
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">
            Conectar una carpeta de Drive
          </h3>
          <p className="mt-1 text-xs text-graphite">
            Centraliza los documentos del proyecto en una carpeta de tu Drive. FARO solo verá los archivos
            dentro de la carpeta vinculada.
          </p>

          <div className="mt-5 grid gap-2">
            <button
              onClick={() => createFolder.mutate({ projectId })}
              disabled={createFolder.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-sm hover:bg-foreground/90 disabled:opacity-60"
            >
              <FolderPlus className="h-4 w-4" />
              {createFolder.isPending ? 'Creando…' : 'Crear carpeta nueva en mi Drive'}
            </button>

            <div className="my-2 text-[10px] uppercase tracking-wider text-graphite">o</div>

            <div className="flex gap-2">
              <input
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="URL o ID de carpeta existente"
                className="flex-1 rounded-lg border border-stone px-3 py-2 text-sm focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal dark:border-ink-body dark:bg-night-700"
              />
              <button
                onClick={handleLink}
                disabled={!linkInput || linkFolder.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone px-3 py-2 text-sm font-medium text-ink-body hover:bg-mist disabled:opacity-50 dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                Vincular
              </button>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ─────────────────────────────────────────────────────────
  if (filesQuery.isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />
        ))}
      </div>
    )
  }

  // ── Linked: show contents ────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
      {/* Header with folder info + actions */}
      <header className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 dark:border-night-700">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-signal-wash dark:bg-signal/40">
          <FolderPlus className="h-4 w-4 text-signal-ink" />
        </div>
        <div className="min-w-0 flex-1">
          <a
            href={folder?.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-night hover:text-night dark:text-stone-100 dark:hover:text-signal"
          >
            <span className="truncate">{folder?.name}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          <p className="text-[10px] text-graphite">
            {files.length} {files.length === 1 ? 'archivo' : 'archivos'} · vinculado a este proyecto
          </p>
        </div>
        <button
          onClick={() => filesQuery.refetch()}
          className="rounded-md p-1.5 text-graphite hover:bg-stone-100 hover:text-ink-body dark:hover:bg-night-700 dark:hover:text-stone"
          title="Refrescar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${filesQuery.isFetching ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => unlink.mutate({ projectId })}
          className="rounded-md p-1.5 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
          title="Desvincular carpeta"
        >
          <Unlink className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* File list */}
      {files.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-graphite">Carpeta vacía.</p>
          <a
            href={folder?.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-signal-ink hover:text-foreground"
          >
            Abrir en Drive para subir archivos
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-night-700">
          {files.map(f => (
            <li key={f.id}>
              <a
                href={f.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-mist dark:hover:bg-night-700/60"
              >
                {f.iconLink ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.iconLink} alt="" className="h-4 w-4 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-graphite" />
                )}
                <span className="flex-1 truncate text-sm text-ink-body dark:text-stone">{f.name}</span>
                <span className="shrink-0 text-[10px] text-graphite">{fmtBytes(f.size)}</span>
                <span className="shrink-0 text-[10px] text-graphite">
                  {new Date(f.modifiedTime).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
