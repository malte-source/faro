'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Globe2, Sparkles } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { COMMON_TIMEZONES } from '@/lib/tz'

/**
 * Timezone settings card — appears on Settings.
 *
 * - User-level TZ override (everyone): falls back to org default when null
 *   so "follow the org" is the natural setting.
 * - Org-level default (admin only): the fallback for users without an
 *   explicit override, plus the TZ used by cron jobs.
 *
 * Browser-detected TZ is shown as a one-click suggestion to set either value.
 */
export function TimezoneCard() {
  const { data: me } = trpc.team.me.useQuery()
  const { data: org } = trpc.team.orgSettings.useQuery()
  const utils = trpc.useUtils()
  const isAdmin = me?.isAdmin ?? false

  // Detect browser TZ on mount (client only)
  const [browserTz, setBrowserTz] = useState<string | null>(null)
  useEffect(() => {
    try {
      setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone)
    } catch {/* ignore */}
  }, [])

  const [userTz, setUserTz] = useState<string>('')  // empty = follow org
  const [orgTz, setOrgTz] = useState<string>('')

  useEffect(() => { if (me?.tz) setUserTz(me.tz) }, [me])
  useEffect(() => { if (org?.timezone) setOrgTz(org.timezone) }, [org])

  const updateMy = trpc.team.updateMyTimezone.useMutation({
    onSuccess: () => { toast.success('Zona horaria actualizada'); utils.team.me.invalidate() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })
  const updateOrg = trpc.team.updateOrgTimezone.useMutation({
    onSuccess: () => { toast.success('Zona horaria de la organización actualizada'); utils.team.orgSettings.invalidate(); utils.team.me.invalidate() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })

  // If browser TZ isn't in the common list, prepend it as an option.
  const userOptions = browserTz && !COMMON_TIMEZONES.find(t => t.value === browserTz)
    ? [{ value: browserTz, label: `${browserTz} (detectada)` }, ...COMMON_TIMEZONES]
    : COMMON_TIMEZONES

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <Globe2 className="h-5 w-5 text-signal-ink" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Zona horaria</h3>
          <p className="text-xs text-graphite">
            FARO usa tu zona horaria para mostrar "hoy", "vence en X días" y disparar avisos en el momento correcto.
          </p>
        </div>
      </div>

      {/* User-level */}
      <div className="space-y-2 border-t border-stone-100 pt-4 dark:border-night-700">
        <label className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-body dark:text-stone">Mi zona horaria</span>
          {browserTz && me?.tz !== browserTz && (
            <button
              onClick={() => { setUserTz(browserTz); updateMy.mutate({ timezone: browserTz }) }}
              className="inline-flex items-center gap-1 text-[11px] text-signal-ink hover:underline dark:text-signal"
              title={`Tu browser está en ${browserTz}`}
            >
              <Sparkles className="h-3 w-3" /> Usar la detectada ({browserTz})
            </button>
          )}
        </label>
        <select
          value={userTz}
          onChange={e => { setUserTz(e.target.value); updateMy.mutate({ timezone: e.target.value || null }) }}
          className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
        >
          <option value="">— Seguir el default de la organización ({org?.timezone}) —</option>
          {userOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="text-[10px] text-graphite">
          Actualmente activa: <span className="font-mono">{me?.tz ?? '—'}</span>
        </p>
      </div>

      {/* Org-level (admin only) */}
      {isAdmin && (
        <div className="mt-4 space-y-2 rounded-lg bg-mist px-3 py-3 dark:bg-night-700/40">
          <label className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-body dark:text-stone">Zona horaria por defecto de la organización</span>
            <span className="rounded bg-signal-wash px-1.5 py-0.5 text-[9px] font-semibold uppercase text-night dark:bg-signal/40 dark:text-signal">Admin</span>
          </label>
          <select
            value={orgTz}
            onChange={e => { setOrgTz(e.target.value); updateOrg.mutate({ timezone: e.target.value }) }}
            className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
          >
            {COMMON_TIMEZONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-[10px] text-graphite">
            Se usa para usuarios sin TZ propia y para los cron jobs (digests, recurrentes, alertas).
          </p>
        </div>
      )}
    </div>
  )
}
