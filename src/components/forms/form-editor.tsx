'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { X, ClipboardList, Plus, Trash2, GripVertical } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { useEscapeClose } from '@/hooks/use-escape-close'
import type { IntakeField, IntakeFieldType, IntakeFieldTarget } from '@/types/database'

interface Props {
  formId: string | null  // null = create new
  onClose: () => void
}

const FIELD_TYPES: Array<{ value: IntakeFieldType; label: string }> = [
  { value: 'text',     label: 'Texto corto' },
  { value: 'textarea', label: 'Texto largo' },
  { value: 'email',    label: 'Email' },
  { value: 'phone',    label: 'Teléfono' },
  { value: 'date',     label: 'Fecha' },
  { value: 'select',   label: 'Lista desplegable' },
]

const FIELD_TARGETS: Array<{ value: IntakeFieldTarget; label: string; hint: string }> = [
  { value: 'title',       label: 'Título de la tarea', hint: 'Lo primero que verás en la lista' },
  { value: 'description', label: 'Descripción',         hint: 'Detalles adicionales' },
  { value: 'due_date',    label: 'Vencimiento',          hint: 'Solo si el tipo es Fecha' },
  { value: 'priority',    label: 'Prioridad',            hint: 'Solo si el tipo es Lista con valores válidos' },
  { value: 'metadata',    label: 'Dato extra',           hint: 'Se incluye en la descripción como "label: valor"' },
]

function newFieldId(): string {
  return `f_${Math.random().toString(36).slice(2, 9)}`
}

function defaultFields(): IntakeField[] {
  return [
    { id: newFieldId(), label: 'Asunto del pedido', type: 'text',     required: true,  target: 'title' },
    { id: newFieldId(), label: 'Detalle',           type: 'textarea', required: true,  target: 'description', placeholder: 'Cuéntanos qué necesitas…' },
    { id: newFieldId(), label: 'Tu email',          type: 'email',    required: true,  target: 'metadata' },
    { id: newFieldId(), label: 'Fecha deseada',     type: 'date',     required: false, target: 'due_date' },
  ]
}

export function FormEditor({ formId, onClose }: Props) {
  const isNew = formId === null
  const utils = trpc.useUtils()
  useEscapeClose(onClose)

  const { data: existing } = trpc.forms.byId.useQuery(formId!, { enabled: !isNew })
  const { data: projects } = trpc.projects.list.useQuery()
  const { data: goals } = trpc.goals.list.useQuery()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [brandingName, setBrandingName] = useState('')
  const [targetProjectId, setTargetProjectId] = useState('')
  const [targetGoalId, setTargetGoalId] = useState('')
  const [defaultPriority, setDefaultPriority] = useState<'very_high' | 'high' | 'medium' | 'low' | 'very_low'>('medium')
  const [successMessage, setSuccessMessage] = useState('')
  const [fields, setFields] = useState<IntakeField[]>(defaultFields())
  const [slug, setSlug] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Seed from existing when editing.
  useEffect(() => {
    if (!existing || isNew) return
    setTitle(existing.title)
    setDescription(existing.description ?? '')
    setBrandingName(existing.branding_name ?? '')
    setTargetProjectId(existing.target_project_id)
    setTargetGoalId(existing.target_goal_id ?? '')
    setDefaultPriority(existing.default_priority)
    setSuccessMessage(existing.success_message)
    setFields((existing.fields as IntakeField[] | null) ?? defaultFields())
    setSlug(existing.slug)
    setIsActive(existing.is_active)
  }, [existing, isNew])

  const create = trpc.forms.create.useMutation({
    onSuccess: () => { toast.success('Formulario creado'); onClose() },
    onError: (e) => toast.error('No se pudo crear', e.message),
  })
  const update = trpc.forms.update.useMutation({
    onSuccess: () => { toast.success('Formulario actualizado'); utils.forms.invalidate(); onClose() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })

  function addField() {
    setFields(fs => [...fs, {
      id: newFieldId(), label: 'Campo nuevo', type: 'text', required: false, target: 'metadata',
    }])
  }
  function updateField(i: number, patch: Partial<IntakeField>) {
    setFields(fs => fs.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  }
  function removeField(i: number) {
    setFields(fs => fs.filter((_, idx) => idx !== i))
  }
  function moveField(i: number, dir: -1 | 1) {
    setFields(fs => {
      const next = [...fs]
      const target = i + dir
      if (target < 0 || target >= next.length) return next
      ;[next[i], next[target]] = [next[target], next[i]]
      return next
    })
  }

  function handleSave() {
    if (!title.trim()) { toast.warning('Falta el título'); return }
    if (!targetProjectId) { toast.warning('Elige un proyecto destino'); return }
    if (fields.length === 0) { toast.warning('Agrega al menos un campo'); return }

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      brandingName: brandingName.trim() || undefined,
      targetProjectId,
      targetGoalId: targetGoalId || undefined,
      defaultPriority,
      fields,
      successMessage: successMessage.trim() || undefined,
    }
    if (isNew) create.mutate(payload)
    else update.mutate({
      id: formId!,
      ...payload,
      description: description.trim() || null,
      brandingName: brandingName.trim() || null,
      targetGoalId: targetGoalId || null,
      isActive,
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:items-center md:p-4 animate-in fade-in" onClick={onClose}>
      <div
        className="max-h-[92dvh] md:max-h-[90vh] w-full max-w-xl md:max-w-3xl overflow-hidden rounded-t-[26px] rounded-b-none md:rounded-2xl bg-white shadow-2xl dark:bg-night animate-in slide-in-from-bottom md:zoom-in-95 md:slide-in-from-bottom-0 flex flex-col pb-[env(safe-area-inset-bottom)] md:pb-0"
        onClick={e => e.stopPropagation()}
      ><span className="mx-auto -mt-2 mb-3 block h-1 w-10 shrink-0 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
        <header className="flex shrink-0 items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-night-700">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-wash dark:bg-signal/40">
              <ClipboardList className="h-4 w-4 text-signal-ink" />
            </span>
            <h2 className="text-base font-semibold">{isNew ? 'Nuevo formulario' : 'Editar formulario'}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Identity */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-graphite dark:text-stone">Título del formulario</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Ej: Pedidos de cliente, Reporte de bug, Solicitud de feature"
                className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-graphite dark:text-stone">Descripción (visible al usuario que llena el form)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="Cuéntale al usuario qué tipo de pedidos esperas en este formulario."
                className="mt-1 w-full resize-none rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-graphite dark:text-stone">Marca visible</label>
                <input
                  value={brandingName}
                  onChange={e => setBrandingName(e.target.value)}
                  placeholder="Ej: Andes Solutions"
                  className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
                />
              </div>
              {!isNew && (
                <div>
                  <label className="text-xs font-medium text-graphite dark:text-stone">Slug URL</label>
                  <input
                    value={slug}
                    onChange={e => setSlug(e.target.value)}
                    disabled
                    className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm font-mono dark:border-ink-body dark:bg-night-700 opacity-60"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Routing */}
          <div className="rounded-lg border border-stone p-3 dark:border-ink-body">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-graphite mb-2">Adónde van los pedidos</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-graphite dark:text-stone">Proyecto destino *</label>
                <select
                  value={targetProjectId}
                  onChange={e => setTargetProjectId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
                >
                  <option value="">— Elegir proyecto —</option>
                  {(projects ?? []).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-graphite dark:text-stone">Vincular a objetivo</label>
                <select
                  value={targetGoalId}
                  onChange={e => setTargetGoalId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
                >
                  <option value="">— Sin objetivo —</option>
                  {(goals ?? []).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-graphite dark:text-stone">Prioridad por defecto</label>
                <select
                  value={defaultPriority}
                  onChange={e => setDefaultPriority(e.target.value as typeof defaultPriority)}
                  className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
                >
                  <option value="very_high">Muy alta</option>
                  <option value="high">Alta</option>
                  <option value="medium">Media</option>
                  <option value="low">Baja</option>
                  <option value="very_low">Muy baja</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-graphite dark:text-stone">Mensaje de éxito</label>
                <input
                  value={successMessage}
                  onChange={e => setSuccessMessage(e.target.value)}
                  placeholder="Recibimos tu pedido. Lo procesaremos a la brevedad."
                  className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
                />
              </div>
            </div>
          </div>

          {/* Fields builder */}
          <div className="rounded-lg border border-stone p-3 dark:border-ink-body">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-graphite">
                Campos del formulario ({fields.length})
              </p>
              <button
                onClick={addField}
                className="inline-flex items-center gap-1 text-xs text-night hover:underline dark:text-signal"
              >
                <Plus className="h-3 w-3" /> agregar campo
              </button>
            </div>
            <ul className="space-y-2">
              {fields.map((f, i) => (
                <li key={f.id} className="rounded-md border border-stone bg-mist p-2 dark:border-ink-body dark:bg-night-700/50">
                  <div className="flex items-start gap-2">
                    <div className="flex shrink-0 flex-col items-center pt-2">
                      <button onClick={() => moveField(i, -1)} disabled={i === 0} className="text-stone hover:text-graphite disabled:opacity-30">
                        <GripVertical className="h-3 w-3 rotate-90" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        value={f.label}
                        onChange={e => updateField(i, { label: e.target.value })}
                        placeholder="Etiqueta del campo"
                        className="w-full rounded border border-stone px-2 py-1 text-xs dark:border-graphite dark:bg-night"
                      />
                      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
                        <select
                          value={f.type}
                          onChange={e => updateField(i, { type: e.target.value as IntakeFieldType })}
                          className="rounded border border-stone px-2 py-1 text-[11px] dark:border-graphite dark:bg-night"
                        >
                          {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <select
                          value={f.target}
                          onChange={e => updateField(i, { target: e.target.value as IntakeFieldTarget })}
                          className="rounded border border-stone px-2 py-1 text-[11px] dark:border-graphite dark:bg-night"
                          title="Adónde va este valor al crear la tarea"
                        >
                          {FIELD_TARGETS.map(t => <option key={t.value} value={t.value}>→ {t.label}</option>)}
                        </select>
                        <label className="inline-flex items-center gap-1 text-[11px]">
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={e => updateField(i, { required: e.target.checked })}
                            className="h-3 w-3"
                          />
                          Obligatorio
                        </label>
                        <input
                          value={f.placeholder ?? ''}
                          onChange={e => updateField(i, { placeholder: e.target.value })}
                          placeholder="Placeholder"
                          className="rounded border border-stone px-2 py-1 text-[11px] dark:border-graphite dark:bg-night"
                        />
                      </div>
                      {f.type === 'select' && (
                        <input
                          value={(f.options ?? []).join(', ')}
                          onChange={e => updateField(i, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
                          placeholder="Opciones separadas por coma (ej: Bajo, Medio, Alto)"
                          className="w-full rounded border border-stone px-2 py-1 text-[11px] dark:border-graphite dark:bg-night"
                        />
                      )}
                    </div>
                    <button
                      onClick={() => removeField(i)}
                      className="rounded p-1 text-stone hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-stone-100 bg-mist px-5 py-3 dark:border-night-700 dark:bg-night-700/40">
          <button onClick={onClose} className="rounded-lg border border-stone px-3 py-1.5 text-xs dark:border-ink-body">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
            className="rounded-lg bg-night px-4 py-1.5 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
          >
            {create.isPending || update.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </div>
    </div>
  )
}
