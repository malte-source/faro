'use client'

import { useState, useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Check, ChevronsUpDown, Plus, Building2, User, Sparkles } from 'lucide-react'
import { toast } from '@/components/ui/toaster'

/**
 * Workspace switcher — the dropdown at the top of the sidebar that lets the
 * user switch between Personal / Team workspaces and create new ones.
 *
 * How switching works:
 *  - We write a cookie `faro:active_org=<orgId>` (1-year expiry, SameSite=Lax).
 *  - Then we full-reload the page so every component re-fetches with the new
 *    ctx. A soft router.refresh() isn't enough because most queries (and the
 *    server-side ctx cache) need to be flushed cold.
 *
 * Why not just trpc.utils.invalidate(): React Query keeps URL state and tab
 * state cached per-query — a reload guarantees a clean slate, matches what
 * Notion/Linear do, and avoids subtle bugs (URLs with old project IDs, etc.).
 */
export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState<'personal' | 'team' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const { data: orgs } = trpc.orgs.mine.useQuery()
  const { data: active } = trpc.orgs.active.useQuery()
  const createPersonal = trpc.orgs.createPersonal.useMutation({
    onSuccess: org => {
      switchTo(org.id)
    },
    onError: e => toast.error('No se pudo crear el workspace', e.message),
  })
  const createTeam = trpc.orgs.createTeam.useMutation({
    onSuccess: org => {
      switchTo(org.id)
    },
    onError: e => toast.error('No se pudo crear el workspace', e.message),
  })

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  function switchTo(orgId: string) {
    if (active?.id === orgId) {
      setOpen(false)
      return
    }
    document.cookie = `faro:active_org=${encodeURIComponent(orgId)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
    // Redirect to /dashboard rather than reload-in-place so we don't 404 when
    // the current URL references a resource (project, task, etc) that exists
    // only in the previous workspace. /dashboard is a safe landing for any org.
    window.location.href = '/dashboard'
  }

  function handleCreate(kind: 'personal' | 'team') {
    const name = window.prompt(
      kind === 'personal'
        ? 'Nombre del workspace personal (ej. "Casa", "Side projects")'
        : 'Nombre del workspace de equipo (ej. "Acme Inc")'
    )
    if (!name?.trim()) return
    setCreating(kind)
    const m = kind === 'personal' ? createPersonal : createTeam
    m.mutate({ name: name.trim() }, {
      onSettled: () => setCreating(null),
    })
  }

  if (!active) {
    return (
      <div className="px-2 py-2 border-b border-stone-100 dark:border-night-700">
        <div className="flex h-9 items-center rounded-lg bg-stone-100 px-3 text-xs text-graphite dark:bg-night-700">
          Cargando…
        </div>
      </div>
    )
  }

  const isPersonal = active.workspace_type === 'personal'
  const Icon = isPersonal ? User : Building2

  return (
    <div ref={ref} className="relative px-2 py-2 border-b border-stone-100 dark:border-night-700">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-stone bg-white px-2.5 py-2 text-left transition-colors hover:border-stone hover:bg-mist active:scale-[0.99] dark:border-ink-body dark:bg-night dark:hover:border-graphite dark:hover:bg-night-700"
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isPersonal ? 'bg-signal-wash text-night dark:bg-signal/50 dark:text-signal' : 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block truncate text-xs font-semibold text-night dark:text-stone-100">{active.name}</span>
          <span className="block text-[10px] text-graphite">
            {isPersonal ? 'Personal' : 'Equipo'} · {active.plan}
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-graphite" />
      </button>

      {open && (
        <div className="absolute left-2 right-2 top-full z-30 mt-1 overflow-hidden rounded-lg border border-stone bg-white shadow-lg dark:border-ink-body dark:bg-night">
          <div className="max-h-72 overflow-y-auto py-1">
            {(orgs ?? []).map(o => {
              const isActive = o.id === active.id
              const oIsPersonal = o.workspace_type === 'personal'
              const OIcon = oIsPersonal ? User : Building2
              return (
                <button
                  key={o.id}
                  onClick={() => switchTo(o.id)}
                  className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-mist dark:hover:bg-night-700"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${oIsPersonal ? 'bg-signal-wash text-night dark:bg-signal/50 dark:text-signal' : 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'}`}>
                    <OIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-xs font-medium text-night dark:text-stone-100">{o.name}</span>
                    <span className="block text-[10px] text-graphite">
                      {oIsPersonal ? 'Personal' : 'Equipo'} · {o.role}
                    </span>
                  </span>
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-signal-ink" />}
                </button>
              )
            })}
          </div>

          <div className="border-t border-stone-100 dark:border-night-700">
            <button
              onClick={() => handleCreate('personal')}
              disabled={!!creating}
              className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs text-graphite transition-colors hover:bg-mist disabled:opacity-50 dark:text-stone dark:hover:bg-night-700"
            >
              <Plus className="h-3.5 w-3.5 text-graphite" />
              Crear workspace personal
            </button>
            <button
              onClick={() => handleCreate('team')}
              disabled={!!creating}
              className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs text-graphite transition-colors hover:bg-mist disabled:opacity-50 dark:text-stone dark:hover:bg-night-700"
            >
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              Crear workspace de equipo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
