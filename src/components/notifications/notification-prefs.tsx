'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { IosSwitch } from '@/components/projects/mobile-bits'
import { haptic } from '@/components/mobile/haptics'

const TIME_INPUT =
  'h-10 rounded-[10px] border border-border bg-surface px-3 text-base text-foreground focus:border-night focus:outline-none focus:ring-2 focus:ring-signal/40 md:text-sm'

type SaveInput = {
  push_enabled?: boolean
  kinds?: Record<string, boolean>
  quiet_start?: string | null
  quiet_end?: string | null
}

/**
 * What to be notified about + quiet hours. Switches save as you flip them (iOS Settings style).
 * A muted kind is not delivered at all (no inbox row, no push); push off and quiet hours only silence the
 * phone — everything still waits in the inbox.
 */
export function NotificationPrefs() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.notifications.prefs.useQuery()
  const save = trpc.notifications.setPrefs.useMutation({
    onSuccess: () => void utils.notifications.prefs.invalidate(),
    onError: err => toast.error('No se pudo guardar', err.message),
  })

  if (isLoading || !data) return <div className="h-64 animate-pulse rounded-[14px] bg-border-soft" aria-busy />

  return (
    <div className="space-y-6">
      <InsetGroup label="Avisos al teléfono" footer="Apagado: no te llegan avisos al dispositivo, pero todo sigue esperándote en la bandeja.">
        <ListRow
          title="Recibir avisos push"
          trailing={
            <IosSwitch
              label="Recibir avisos push"
              checked={data.prefs.push_enabled}
              onChange={v => { haptic(); save.mutate({ push_enabled: v }) }}
            />
          }
        />
      </InsetGroup>

      <InsetGroup label="Qué quieres recibir" footer="Si apagas un tipo, no aparece ni en la bandeja ni en el teléfono.">
        {data.kinds.map(k => (
          <ListRow
            key={k.kind}
            title={k.label}
            subtitle={k.description}
            trailing={
              <IosSwitch
                label={k.label}
                checked={k.enabled}
                onChange={v => { haptic(); save.mutate({ kinds: { [k.kind]: v } }) }}
              />
            }
          />
        ))}
      </InsetGroup>

      {/* Re-mounted when the saved window changes, so the inputs always start from what is stored. */}
      <QuietHours
        key={`${data.prefs.quiet_start ?? ''}-${data.prefs.quiet_end ?? ''}`}
        savedStart={data.prefs.quiet_start}
        savedEnd={data.prefs.quiet_end}
        save={input => save.mutate(input)}
      />
    </div>
  )
}

function QuietHours({
  savedStart,
  savedEnd,
  save,
}: {
  savedStart: string | null
  savedEnd: string | null
  save: (input: SaveInput) => void
}) {
  const [start, setStart] = useState(savedStart ?? '22:00')
  const [end, setEnd] = useState(savedEnd ?? '07:00')
  const on = !!(savedStart && savedEnd)

  return (
    <InsetGroup label="Horas de silencio" footer="Durante este horario no suena el teléfono. Lo que llegue te espera en la bandeja. Usa tu hora local.">
      <ListRow
        title="Silenciar de noche"
        subtitle={on ? `De ${savedStart} a ${savedEnd}` : 'Apagado'}
        trailing={
          <IosSwitch
            label="Silenciar de noche"
            checked={on}
            onChange={v => {
              haptic()
              if (v) save({ quiet_start: start, quiet_end: end })
              else save({ quiet_start: null, quiet_end: null })
            }}
          />
        }
      />
      {on && (
        <div className="flex items-center gap-3 px-4 py-3">
          <label className="flex flex-1 flex-col gap-1 text-[12px] font-medium text-graphite">
            Desde
            <input
              type="time"
              value={start}
              className={TIME_INPUT}
              onChange={e => setStart(e.target.value)}
              onBlur={() => start && start !== savedStart && save({ quiet_start: start })}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[12px] font-medium text-graphite">
            Hasta
            <input
              type="time"
              value={end}
              className={TIME_INPUT}
              onChange={e => setEnd(e.target.value)}
              onBlur={() => end && end !== savedEnd && save({ quiet_end: end })}
            />
          </label>
        </div>
      )}
    </InsetGroup>
  )
}
