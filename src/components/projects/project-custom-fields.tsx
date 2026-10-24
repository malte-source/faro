'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Tags } from 'lucide-react'

interface Props {
  projectId: string
  values: Record<string, string | number | null>
}

/**
 * Renders the org's custom field definitions as editable inputs on a
 * project. Values are saved per-field on blur (or change for date/select).
 * Hidden entirely if the org has defined no custom fields.
 */
export function ProjectCustomFields({ projectId, values }: Props) {
  const utils = trpc.useUtils()
  const { data: defs } = trpc.templates.listCustomFields.useQuery()
  const [local, setLocal] = useState<Record<string, string | number | null>>(values)

  useEffect(() => { setLocal(values) }, [values])

  const setValue = trpc.projects.setCustomFieldValue.useMutation({
    onSuccess: () => utils.projects.invalidate(),
  })

  if (!defs || defs.length === 0) return null

  function commit(key: string, value: string | number | null) {
    setValue.mutate({ projectId, key, value })
  }

  return (
    <div className="rounded-xl border border-stone bg-white p-4 dark:border-night-700 dark:bg-night">
      <div className="mb-3 flex items-center gap-2">
        <Tags className="h-3.5 w-3.5 text-graphite" />
        <h3 className="text-sm font-semibold text-ink-body dark:text-stone">Campos personalizados</h3>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {defs.map(f => {
          const v = local[f.key] ?? ''
          return (
            <div key={f.key}>
              <dt className="mb-0.5 text-[10px] uppercase tracking-wider text-graphite">{f.label}</dt>
              <dd>
                {f.type === 'select' ? (
                  <select
                    value={String(v)}
                    onChange={e => { setLocal({ ...local, [f.key]: e.target.value }); commit(f.key, e.target.value) }}
                    className="w-full rounded-lg border border-stone px-2 py-1.5 text-sm dark:border-ink-body dark:bg-night-700"
                  >
                    <option value="">—</option>
                    {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={String(v)}
                    onChange={e => setLocal({ ...local, [f.key]: e.target.value })}
                    onBlur={e => {
                      const raw = e.target.value
                      const parsed = f.type === 'number' ? (raw === '' ? null : Number(raw)) : (raw || null)
                      commit(f.key, parsed)
                    }}
                    className="w-full rounded-lg border border-stone px-2 py-1.5 text-sm dark:border-ink-body dark:bg-night-700"
                  />
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
