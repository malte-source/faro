'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, FileText, Plus, Search } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { FieldSelect } from '@/components/personas/field-select'
import { NewDocumentDialog } from '@/components/documentos/new-document-dialog'
import { DOC_KINDS, DOC_KIND_LABEL, DOC_STATUS_BADGE, DOC_STATUS_LABEL } from '@/lib/documents'
import { cn } from '@/lib/utils'
import type { DocumentKind, DocumentStatus } from '@/types/database'

const ALL = '__all__'
const GRUPO = '__grupo__'
const STATUSES: Array<{ value: DocumentStatus | typeof ALL; label: string }> = [
  { value: ALL, label: 'Todos' },
  { value: 'borrador', label: DOC_STATUS_LABEL.borrador },
  { value: 'en_revision', label: DOC_STATUS_LABEL.en_revision },
  { value: 'aprobado', label: DOC_STATUS_LABEL.aprobado },
  { value: 'obsoleto', label: DOC_STATUS_LABEL.obsoleto },
]

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Button for the page header: opens the "Nuevo documento" dialog. */
export function NewDocumentButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="signal" onClick={() => setOpen(true)} className="h-9 rounded-full px-4 md:h-8 md:rounded-[10px] md:px-3">
        <Plus className="h-4 w-4" /> Nuevo documento
      </Button>
      <NewDocumentDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function DocumentsList() {
  const [status, setStatus] = useState<DocumentStatus | typeof ALL>(ALL)
  const [kind, setKind] = useState<DocumentKind | typeof ALL>(ALL)
  const [scope, setScope] = useState<string>(ALL)
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  const { data, isLoading, error } = trpc.documents.list.useQuery({
    status: status === ALL ? undefined : status,
    kind: kind === ALL ? undefined : kind,
    workspaceId: scope !== ALL && scope !== GRUPO ? scope : undefined,
    mine: mine || undefined,
    q: q.trim() || undefined,
  })

  // "Todo el grupo" is filtered client-side (the router has no "grupo only" filter).
  const docs = (data?.documents ?? []).filter(d => (scope === GRUPO ? !d.workspace : true))
  const hasFilters = status !== ALL || kind !== ALL || scope !== ALL || mine || !!q.trim()

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div
        className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
        role="group"
        aria-label="Filtrar por estado"
        data-no-track
        data-no-ptr
      >
        {STATUSES.map(s => (
          <button
            key={s.value}
            type="button"
            onClick={() => setStatus(s.value)}
            aria-pressed={status === s.value}
            className={cn(
              'h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors active:scale-[0.97] md:h-auto md:px-3 md:py-1 md:text-xs',
              status === s.value
                ? 'border-night bg-night text-mist dark:border-signal dark:bg-signal dark:text-night'
                : 'border-stone bg-white text-graphite hover:border-graphite hover:text-foreground dark:border-night-700 dark:bg-night dark:text-stone',
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMine(v => !v)}
          aria-pressed={mine}
          className={cn(
            'h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors md:ml-auto md:h-auto md:px-3 md:py-1 md:text-xs',
            mine ? 'border-signal bg-signal-wash text-signal-ink dark:bg-night-700 dark:text-signal' : 'border-stone text-graphite hover:text-foreground dark:border-night-700',
          )}
        >
          Solo míos
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-graphite md:left-3 md:h-4 md:w-4" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por título o etiqueta…" className="h-11 rounded-[12px] bg-border-soft pl-10 md:h-9 md:rounded-md md:bg-transparent md:pl-9" aria-label="Buscar documentos" enterKeyHint="search" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <FieldSelect
            value={kind}
            onChange={v => setKind(v as DocumentKind | typeof ALL)}
            className="sm:w-48"
            options={[{ value: ALL, label: 'Todos los tipos' }, ...DOC_KINDS.map(k => ({ value: k.value, label: k.label }))]}
          />
          <FieldSelect
            value={scope}
            onChange={setScope}
            className="sm:w-52"
            options={[
              { value: ALL, label: 'Todas las empresas' },
              { value: GRUPO, label: 'Solo de todo el grupo' },
              ...(data?.empresas ?? []).map(e => ({ value: e.id, label: e.name })),
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="No se pudieron cargar los documentos" description={error.message} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={hasFilters ? 'Ningún documento coincide' : 'Aún no hay documentos'}
          description={hasFilters ? 'Prueba quitando algún filtro.' : 'Crea el Manual Técnico, una política o un SOP. Faro puede redactar el primer borrador con la estructura del grupo.'}
          action={!hasFilters ? <Button size="sm" variant="signal" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nuevo documento</Button> : undefined}
        />
      ) : (
        <ul className="divide-y divide-border-soft overflow-hidden rounded-[14px] border border-border bg-surface md:rounded-xl">
          {docs.map(d => (
            <li key={d.id}>
              <Link href={`/dashboard/documentos/${d.id}`} className="flex min-h-[72px] items-start gap-3 px-4 py-3.5 transition-colors active:bg-border-soft hover:bg-background md:min-h-0 md:py-3">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-border-soft text-graphite md:h-8 md:w-8 md:rounded-lg">
                  <FileText className="h-[18px] w-[18px] md:h-4 md:w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[16px] font-semibold text-foreground md:text-sm">{d.title}</span>
                    <Badge variant={DOC_STATUS_BADGE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Badge>
                    {d.reviewOverdue && (
                      <Badge variant="danger" title={d.nextReviewAt ? `Debía revisarse el ${shortDate(d.nextReviewAt)}` : undefined}>
                        <AlertTriangle className="h-3 w-3" /> Revisión vencida
                      </Badge>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-graphite md:text-xs">
                    <span>{DOC_KIND_LABEL[d.kind]}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      {d.workspace ? <><span className="h-1.5 w-1.5 rounded-full" style={{ background: d.workspace.color }} />{d.workspace.name}</> : 'Todo el grupo'}
                    </span>
                    <span aria-hidden>·</span>
                    <span>v{d.version}</span>
                    {d.owner && <><span aria-hidden>·</span><span>{d.owner.name}</span></>}
                    <span aria-hidden>·</span>
                    <span>Actualizado {shortDate(d.updatedAt)}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewDocumentDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
