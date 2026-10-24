'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldSelect } from '@/components/personas/field-select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { DOC_KINDS } from '@/lib/documents'
import type { DocumentKind } from '@/types/database'

const ALL = '__all__'

export interface NewDocumentDialogProps {
  open: boolean
  onClose: () => void
  /** Link the new document to a task (and its project). */
  taskId?: string
  projectId?: string
  defaultTitle?: string
  defaultBrief?: string
  defaultKind?: DocumentKind
  defaultWorkspaceId?: string | null
  defaultMode?: 'blank' | 'ai'
}

/**
 * "Nuevo documento": empty, or drafted by Faro from a brief (optionally using the grupo's structure).
 * The form is mounted fresh on every open, so defaults (e.g. another task) always apply.
 */
export function NewDocumentDialog(props: NewDocumentDialogProps) {
  if (!props.open) return null
  return <NewDocumentForm {...props} />
}

function NewDocumentForm({
  onClose, taskId, projectId, defaultTitle = '', defaultBrief = '', defaultKind = 'politica', defaultWorkspaceId = null, defaultMode = 'ai',
}: NewDocumentDialogProps) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data: dir } = trpc.membership.directory.useQuery(undefined, { staleTime: 60_000 })

  const [mode, setMode] = useState<'blank' | 'ai'>(defaultMode)
  const [kind, setKind] = useState<DocumentKind>(defaultKind)
  const [title, setTitle] = useState(defaultTitle)
  const [brief, setBrief] = useState(defaultBrief)
  const [workspaceId, setWorkspaceId] = useState<string>(defaultWorkspaceId ?? ALL)
  const [useStructure, setUseStructure] = useState(true)

  const create = trpc.documents.create.useMutation()
  const generate = trpc.documents.generate.useMutation()
  const busy = create.isPending || generate.isPending

  const wsValue = workspaceId === ALL ? null : workspaceId

  async function submit() {
    if (!title.trim() || busy) return
    try {
      let body = ''
      if (mode === 'ai') {
        const out = await generate.mutateAsync({ kind, title: title.trim(), brief, workspaceId: wsValue, useStructure })
        body = out.body_md
      }
      const created = await create.mutateAsync({
        title: title.trim(), kind, body_md: body, workspaceId: wsValue,
        ...(taskId ? { taskId } : {}), ...(projectId ? { projectId } : {}),
      })
      void utils.documents.invalidate()
      toast.success(mode === 'ai' ? 'Borrador listo' : 'Documento creado', mode === 'ai' ? 'Revísalo y completa los marcadores [COMPLETAR].' : undefined)
      onClose()
      router.push(`/dashboard/documentos/${created.id}`)
    } catch (err) {
      toast.error(mode === 'ai' ? 'No se pudo generar el documento' : 'No se pudo crear el documento', err instanceof Error ? err.message : undefined)
    }
  }

  const modeBtn = (m: 'blank' | 'ai', icon: React.ReactNode, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={cn(
        'flex flex-1 items-start gap-2.5 rounded-[14px] border p-3.5 text-left transition-colors active:scale-[0.99] md:rounded-xl md:p-3',
        mode === m
          ? 'border-night bg-mist dark:border-signal dark:bg-night-700'
          : 'border-border hover:border-graphite',
      )}
    >
      <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', mode === m ? 'bg-signal text-night' : 'bg-stone-100 text-graphite dark:bg-night-700')}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-night dark:text-mist">{label}</span>
        <span className="block text-xs text-graphite">{hint}</span>
      </span>
    </button>
  )

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-xl p-6">
        <DialogHeader>
          <DialogTitle>Nuevo documento</DialogTitle>
          <DialogDescription>
            {taskId ? 'Se vinculará a la tarea. ' : ''}Empieza en blanco o deja que Faro redacte un primer borrador.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            {modeBtn('ai', <Sparkles className="h-4 w-4" />, 'Generar con IA', 'Faro redacta el borrador')}
            {modeBtn('blank', <FileText className="h-4 w-4" />, 'En blanco', 'Lo escribes tú')}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <FieldSelect value={kind} onChange={v => setKind(v as DocumentKind)} options={DOC_KINDS.map(k => ({ value: k.value, label: k.label }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Ámbito</Label>
              <FieldSelect
                value={workspaceId}
                onChange={setWorkspaceId}
                options={[{ value: ALL, label: 'Todo el grupo' }, ...(dir?.workspaces ?? []).map(w => ({ value: w.id, label: w.name }))]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Título</Label>
            <Input id="doc-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej: Política de gasto y aprobaciones" maxLength={160} autoFocus />
          </div>

          {mode === 'ai' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="doc-brief">¿Qué debe decir? <span className="font-normal text-graphite">(opcional, mientras más contexto mejor)</span></Label>
                <Textarea
                  id="doc-brief"
                  rows={5}
                  value={brief}
                  onChange={e => setBrief(e.target.value)}
                  maxLength={3000}
                  placeholder="Ej: El gasto sobre un umbral lo aprueba el CFO; los demás los aprueba el BU Manager. Aplica a todas las filiales."
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-signal-wash/60 p-3 text-sm dark:bg-night-700">
                <input type="checkbox" checked={useStructure} onChange={e => setUseStructure(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#FFB020] md:h-4 md:w-4" />
                <span>
                  <span className="font-medium text-night dark:text-mist">Usar la estructura del grupo</span>
                  <span className="block text-xs text-graphite">Empresas, cargos, capas y líneas de reporte reales. Lo que no esté, queda como [COMPLETAR].</span>
                </span>
              </label>
            </>
          )}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
            {busy && mode === 'ai' && <span className="text-xs text-graphite sm:mr-auto">Faro está redactando… puede tardar unos segundos.</span>}
            <Button variant="ghost" className="h-12 sm:h-9" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button className="h-12 sm:h-9" variant={mode === 'ai' ? 'signal' : 'default'} onClick={() => void submit()} disabled={!title.trim() || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'ai' ? <Sparkles className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {busy ? (mode === 'ai' ? 'Redactando…' : 'Creando…') : mode === 'ai' ? 'Generar borrador' : 'Crear documento'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
