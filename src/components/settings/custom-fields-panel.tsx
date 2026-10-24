'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Plus, Trash2, ListPlus } from 'lucide-react'

type FieldType = 'text' | 'number' | 'date' | 'select'
interface FieldDef { key: string; label: string; type: FieldType; options?: string[] }

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto', number: 'Número', date: 'Fecha', select: 'Lista',
}

/**
 * Settings → Integraciones → custom field definitions (org-level).
 * Fields defined here appear on every project's Detalles tab.
 */
export function CustomFieldsPanel() {
  const utils = trpc.useUtils()
  const { data: serverDefs } = trpc.templates.listCustomFields.useQuery()
  const [defs, setDefs] = useState<FieldDef[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => { if (serverDefs) setDefs(serverDefs) }, [serverDefs])

  const save = trpc.templates.setCustomFields.useMutation({
    onSuccess: () => { utils.templates.listCustomFields.invalidate(); setDirty(false) },
  })

  function addField() {
    const key = `field_${Date.now().toString(36)}`
    setDefs([...defs, { key, label: '', type: 'text' }])
    setDirty(true)
  }
  function updateField(i: number, patch: Partial<FieldDef>) {
    setDefs(defs.map((f, idx) => idx === i ? { ...f, ...patch } : f))
    setDirty(true)
  }
  function removeField(i: number) {
    setDefs(defs.filter((_, idx) => idx !== i))
    setDirty(true)
  }

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Campos personalizados</h3>
          <p className="text-xs text-graphite">Aparecen en la pestaña Detalles de cada proyecto. Ej: Nº contrato, presupuesto cliente, marca.</p>
        </div>
        <button onClick={addField} className="inline-flex items-center gap-1 rounded-lg border border-stone px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist dark:border-ink-body dark:text-stone dark:hover:bg-night-700">
          <Plus className="h-3 w-3" /> Campo
        </button>
      </div>

      {defs.length === 0 ? (
        <p className="py-6 text-center text-xs text-graphite">Sin campos definidos.</p>
      ) : (
        <ul className="space-y-2">
          {defs.map((f, i) => (
            <li key={f.key} className="space-y-1.5 rounded-lg border border-stone-100 p-2 dark:border-night-700">
              <div className="flex items-center gap-2">
                <input
                  value={f.label}
                  onChange={e => updateField(i, { label: e.target.value })}
                  placeholder="Etiqueta del campo"
                  className="flex-1 rounded border border-stone px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
                />
                <select
                  value={f.type}
                  onChange={e => updateField(i, { type: e.target.value as FieldType })}
                  className="rounded border border-stone bg-white px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
                >
                  {(Object.keys(TYPE_LABELS) as FieldType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
                <button onClick={() => removeField(i)} className="rounded p-1 text-stone hover:text-danger">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {f.type === 'select' && (
                <input
                  value={(f.options ?? []).join(', ')}
                  onChange={e => updateField(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="Opciones separadas por coma (ej: Alta, Media, Baja)"
                  className="w-full rounded border border-dashed border-stone px-2 py-1 text-[11px] dark:border-ink-body dark:bg-night-700"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {dirty && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => save.mutate({ defs: defs.filter(d => d.label.trim()) })}
            disabled={save.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
          >
            <ListPlus className="h-3 w-3" />
            {save.isPending ? 'Guardando…' : 'Guardar campos'}
          </button>
        </div>
      )}
    </div>
  )
}
