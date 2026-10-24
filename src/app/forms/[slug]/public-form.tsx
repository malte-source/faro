'use client'

import { useState } from 'react'
import { CheckCircle2, Send, Loader2, AlertTriangle } from 'lucide-react'
import type { IntakeField } from '@/types/database'

interface Props {
  slug: string
  title: string
  description: string | null
  brandingName: string | null
  fields: IntakeField[]
  successMessage: string
}

/**
 * The public form UI — no FARO chrome (no sidebar, no nav). Clean branded page.
 * Submits to /api/forms/{slug}/submit which is the open endpoint.
 *
 * Honeypot field "__website" — hidden from real users, bots auto-fill every
 * input and trip it. Server silently discards on hit.
 */
export function PublicForm({ slug, title, description, brandingName, fields, successMessage }: Props) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function update(id: string, value: string) {
    setValues(v => ({ ...v, [id]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    // Client-side required check before round-trip.
    for (const f of fields) {
      if (f.required && !values[f.id]?.trim()) {
        setError(`Falta completar: ${f.label}`)
        return
      }
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/forms/${slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: values, __website: honeypot }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Error al enviar el formulario.')
        setSubmitting(false)
        return
      }
      setDone({ message: data.message ?? successMessage })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red')
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-success/30 bg-white p-8 text-center shadow-sm dark:border-success/40 dark:bg-night">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <h1 className="mt-4 text-xl font-bold text-night dark:text-stone-100">¡Gracias!</h1>
        <p className="mt-2 text-sm text-graphite dark:text-stone">{done.message}</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-stone bg-white p-6 shadow-sm dark:border-night-700 dark:bg-night">
      {/* Header */}
      <header className="mb-6 border-b border-stone-100 pb-4 dark:border-night-700">
        {brandingName && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-night dark:text-signal">
            {brandingName}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-bold text-night dark:text-stone-100">{title}</h1>
        {description && (
          <p className="mt-2 text-sm text-graphite dark:text-graphite">{description}</p>
        )}
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        {fields.map(f => (
          <div key={f.id}>
            <label htmlFor={`field-${f.id}`} className="mb-1 block text-sm font-medium text-ink-body dark:text-stone">
              {f.label}
              {f.required && <span className="ml-0.5 text-danger">*</span>}
            </label>
            {renderInput(f, values[f.id] ?? '', (v) => update(f.id, v))}
          </div>
        ))}

        {/* Honeypot — hidden from real users. Bots fill EVERY input. */}
        <div className="absolute -left-[10000px] top-0" aria-hidden="true">
          <label>
            Sitio web (no completar):
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={e => setHoneypot(e.target.value)}
            />
          </label>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-danger-wash px-3 py-2 text-sm text-danger dark:bg-danger/30 dark:text-danger/50">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-night px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-night-700 active:scale-[0.98] disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </div>
  )
}

function renderInput(f: IntakeField, value: string, onChange: (v: string) => void) {
  const base = 'w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm shadow-sm focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/20 dark:border-ink-body dark:bg-night-700 dark:text-stone-100'
  const props = {
    id: `field-${f.id}`,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(e.target.value),
    placeholder: f.placeholder,
    required: f.required,
    className: base,
  }
  switch (f.type) {
    case 'textarea':
      return <textarea {...props} rows={4} className={`${base} resize-y`} />
    case 'email':
      return <input {...props} type="email" />
    case 'phone':
      return <input {...props} type="tel" />
    case 'date':
      return <input {...props} type="date" />
    case 'select':
      return (
        <select {...props}>
          <option value="">— Elegir —</option>
          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    default:
      return <input {...props} type="text" />
  }
}
