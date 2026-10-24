'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, Check, X, Building2, User } from 'lucide-react'
import { toast } from '@/components/ui/toaster'

/**
 * Settings → Plan card. Shows the active workspace's plan + what's included +
 * upgrade CTA (creates a new Team workspace for free workspaces).
 *
 * We deliberately don't try to "upgrade in place" — a free Personal workspace
 * is a different mental model than a paid Team one (single user vs. multi).
 * Upgrading means CREATING a Team workspace and inviting people in. The
 * personal one keeps existing for your private stuff.
 */

const FEATURES_BY_PLAN: Record<string, { included: string[]; missing: string[] }> = {
  free: {
    included: [
      'Hasta 5 proyectos activos',
      '1 usuario (tú)',
      'Vistas día / semana / mes',
      'Tareas recurrentes',
      'Sync de calendario',
    ],
    missing: [
      'IA: resumir comentarios, parsear reuniones',
      'Automatizaciones',
      'Forms públicos',
      'Objetivos / OKRs',
      'Email-to-task',
      'Múltiples miembros',
    ],
  },
  team: {
    included: [
      'Proyectos ilimitados',
      'Hasta 30 miembros',
      'IA, Automatizaciones, Forms',
      'Goals / OKRs',
      'Share links + Email-to-task',
    ],
    missing: ['SSO + audit log (en team_plus)'],
  },
  team_plus: {
    included: ['Todo del plan Team', 'Miembros ilimitados', 'SSO + audit log', 'Soporte prioritario'],
    missing: [],
  },
  business: {
    included: ['Todo del plan Team+', 'Soporte dedicado'],
    missing: [],
  },
}

export function PlanCard() {
  const [creating, setCreating] = useState(false)
  const { data: active } = trpc.orgs.active.useQuery()
  const createTeam = trpc.orgs.createTeam.useMutation({
    onSuccess: org => {
      // Switch to the new workspace immediately so the upgrade feels finished.
      document.cookie = `faro:active_org=${encodeURIComponent(org.id)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
      toast.success('Workspace de equipo creado', `Te llevamos a "${org.name}"`)
      window.location.href = '/dashboard'
    },
    onError: e => {
      setCreating(false)
      toast.error('No se pudo crear el workspace', e.message)
    },
  })

  function handleUpgrade() {
    const name = window.prompt('Nombre del workspace de equipo (ej. "Acme Inc")')
    if (!name?.trim()) return
    setCreating(true)
    createTeam.mutate({ name: name.trim() })
  }

  if (!active) {
    return <div className="h-32 animate-pulse rounded-2xl bg-stone-100 dark:bg-night-700" />
  }

  const plan = active.plan
  const features = FEATURES_BY_PLAN[plan] ?? FEATURES_BY_PLAN.free
  const isFree = plan === 'free'
  const isPersonal = active.workspace_type === 'personal'
  const Icon = isPersonal ? User : Building2

  return (
    <div className="rounded-2xl border border-stone bg-white p-5 dark:border-ink-body dark:bg-night">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isFree ? 'bg-stone-100 text-graphite dark:bg-night-700 dark:text-graphite' : 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal'}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-night dark:text-stone-100">
              {active.name}
            </h3>
            <p className="text-xs text-graphite dark:text-graphite">
              Plan <span className="font-medium uppercase tracking-wide">{plan}</span>
              {' · '}
              {isPersonal ? 'Personal' : 'Equipo'}
            </p>
          </div>
        </div>
        {isFree && (
          <button
            onClick={handleUpgrade}
            disabled={creating}
            className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold sm:h-auto sm:w-auto text-white shadow-sm transition-all hover:bg-violet-700 active:scale-95 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {creating ? 'Creando…' : 'Crear workspace de equipo'}
          </button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">Incluido</h4>
          <ul className="space-y-1.5">
            {features.included.map(f => (
              <li key={f} className="flex items-start gap-1.5 text-xs text-ink-body dark:text-stone">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
        {features.missing.length > 0 && (
          <div>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">
              {isFree ? 'Mejora para…' : 'No disponible'}
            </h4>
            <ul className="space-y-1.5">
              {features.missing.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs text-graphite dark:text-graphite">
                  <X className="mt-0.5 h-3 w-3 shrink-0 text-stone" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
