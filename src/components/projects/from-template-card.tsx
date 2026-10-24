'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, FolderPlus, ArrowRight, Settings } from 'lucide-react'
import Link from 'next/link'

/**
 * "Crear desde plantilla" — alternative entry point on /dashboard/projects/new.
 * Shows the user's templates and lets them spin up a fully-formed project
 * with seed tasks in one click.
 */
export function FromTemplateCard() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data: templates } = trpc.templates.list.useQuery()
  const [selectedId, setSelectedId] = useState<string>('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const apply = trpc.templates.applyTemplate.useMutation({
    onSuccess: (res) => {
      utils.projects.list.invalidate()
      router.push(`/dashboard/projects/${res.project.id}`)
    },
  })

  if (!templates || templates.length === 0) {
    return (
      <div className="mb-5 rounded-xl border border-dashed border-stone bg-white p-5 text-center dark:border-ink-body dark:bg-night">
        <Sparkles className="mx-auto h-6 w-6 text-signal-ink" />
        <p className="mt-2 text-sm font-medium text-ink-body dark:text-stone">
          Acelera la creación de proyectos con plantillas
        </p>
        <p className="mt-1 text-xs text-graphite">
          Define plantillas reutilizables con tareas y duraciones para tipos de proyecto recurrentes.
        </p>
        <Link
          href="/dashboard/settings"
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink-body transition hover:bg-mist dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
        >
          <Settings className="h-3 w-3" />
          Configurar plantillas
        </Link>
      </div>
    )
  }

  const selected = templates.find(t => t.id === selectedId)
  const taskCount = (selected?.tasks as { id: string }[] | null)?.length ?? 0

  return (
    <div className="mb-5 rounded-xl border border-stone bg-gradient-to-br from-signal-wash/60 via-white to-white p-4 dark:border-signal/40 dark:from-[#17313F] dark:via-night dark:to-night">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-signal">Crear desde plantilla</h3>
          <p className="text-[10px] uppercase tracking-wider text-signal-ink/80">
            Acelera con una estructura predefinida
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-lg border border-stone bg-white px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
        >
          <option value="">— Elige plantilla —</option>
          {templates.map(t => {
            const n = (t.tasks as { id: string }[] | null)?.length ?? 0
            return <option key={t.id} value={t.id}>{t.name} ({n} tareas{t.duration_days ? ` · ${t.duration_days}d` : ''})</option>
          })}
        </select>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código (P-NN)"
          className="rounded-lg border border-stone bg-white px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del proyecto"
          className="rounded-lg border border-stone bg-white px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
        />
        <button
          onClick={() => apply.mutate({ templateId: selectedId, code: code.trim(), name: name.trim() })}
          disabled={!selectedId || !code.trim() || !name.trim() || apply.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
        >
          {apply.isPending ? 'Creando…' : (
            <>
              <FolderPlus className="h-3.5 w-3.5" />
              Crear
              <ArrowRight className="h-3 w-3" />
            </>
          )}
        </button>
      </div>

      {selected && (
        <p className="mt-2 text-[11px] text-night/80 dark:text-signal/80">
          Se creará el proyecto + <strong>{taskCount} tareas</strong>
          {selected.duration_days && ` con vencimiento estimado a ${selected.duration_days} días`}.
        </p>
      )}

      {apply.isError && (
        <p className="mt-2 text-xs text-danger">{apply.error.message}</p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-stone pt-2 text-[10px] dark:border-signal/40">
        <span className="text-graphite">¿No te alcanza? Llena el formulario completo abajo.</span>
        <Link href="/dashboard/settings" className="text-signal-ink hover:text-foreground">
          Editar plantillas →
        </Link>
      </div>
    </div>
  )
}
