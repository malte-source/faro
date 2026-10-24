'use client'

import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { Segmented } from '@/components/mobile/segmented'
import { IosSwitch } from '@/components/projects/mobile-bits'
import { haptic } from '@/components/mobile/haptics'
import type { EmailKindRule } from '@/lib/email-prefs'

const SELECT =
  'h-10 rounded-[10px] border border-border bg-surface px-3 text-base text-foreground focus:border-night focus:outline-none focus:ring-2 focus:ring-signal/40 md:text-sm'

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
const HOURS = Array.from({ length: 24 }, (_, h) => h)

type SaveInput = {
  email_digest?: 'off' | 'daily' | 'weekly'
  digest_hour?: number
  email_instant?: boolean
  email_kinds?: Record<string, boolean | null>
}

/**
 * Email: the daily/weekly summary and the few instant emails (what someone is waiting on).
 * Same iOS-Settings behaviour as the rest of Avisos: everything saves as you change it.
 */
export function EmailPrefs() {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.emailPrefs.get.useQuery()
  const save = trpc.emailPrefs.set.useMutation({
    onSuccess: () => void utils.emailPrefs.get.invalidate(),
    onError: err => {
      toast.error('No se pudo guardar', err.message)
      void utils.emailPrefs.get.invalidate()
    },
  })
  const test = trpc.emailPrefs.sendTest.useMutation({
    onSuccess: r => toast.success('Correo enviado', `Revisa la bandeja de ${r.sentTo}. Si no llega en un minuto, mira en spam.`),
    onError: err => toast.error('No se pudo enviar', err.message),
  })

  if (isLoading || !data) return <div className="h-64 animate-pulse rounded-[14px] bg-border-soft" aria-busy />

  const { prefs, kinds } = data
  const digestOn = prefs.email_digest !== 'off'
  const mutate = (input: SaveInput) => save.mutate(input)

  return (
    <div className="space-y-6">
      {!data.available && (
        <p className="rounded-[14px] border border-border bg-surface px-4 py-3 text-sm text-body">
          Falta activar el correo en la base de datos (migración <code className="text-[13px]">20261027_email_prefs</code>). Mientras tanto no puedes cambiar estas opciones.
        </p>
      )}
      {data.available && !data.configured && (
        <p className="rounded-[14px] border border-border bg-surface px-4 py-3 text-sm text-body">
          El servidor aún no tiene correo configurado. Puedes dejar tus preferencias listas; los correos empiezan a salir cuando se configure.
        </p>
      )}

      <InsetGroup
        label="Resumen por correo"
        footer={
          data.email
            ? `Te lo enviamos a ${data.email}, a la hora que elijas según tu zona horaria. El semanal llega los lunes. Si no tienes nada pendiente, no te escribimos.`
            : 'Si no tienes nada pendiente, no te escribimos.'
        }
      >
        <div className="px-4 py-3">
          <Segmented
            aria-label="Frecuencia del resumen"
            value={prefs.email_digest}
            onChange={v => mutate({ email_digest: v })}
            options={[
              { value: 'daily', label: 'Diario' },
              { value: 'weekly', label: 'Semanal' },
              { value: 'off', label: 'No enviar' },
            ]}
          />
        </div>
        {digestOn && (
          <ListRow
            title="Hora de envío"
            trailing={
              <select
                aria-label="Hora de envío"
                className={SELECT}
                value={prefs.digest_hour}
                onChange={e => mutate({ digest_hour: Number(e.target.value) })}
              >
                {HOURS.map(h => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
            }
          />
        )}
      </InsetGroup>

      <InsetGroup
        label="Avisos instantáneos"
        footer="El correo es la excepción: solo lo que alguien espera de ti. Máximo 10 al día, y si ya te avisamos al teléfono no te repetimos por correo (salvo que lo pidas aquí)."
      >
        <ListRow
          title="Recibir avisos por correo"
          trailing={
            <IosSwitch
              label="Recibir avisos por correo"
              checked={prefs.email_instant}
              onChange={v => { haptic(); mutate({ email_instant: v }) }}
            />
          }
        />
      </InsetGroup>

      {prefs.email_instant && (
        <InsetGroup label="Qué avisos van por correo">
          {kinds.map(k =>
            k.kind === 'task_assigned' ? (
              <div key={k.kind} className="space-y-2 px-4 py-3">
                <div>
                  <p className="text-[15px] font-medium text-foreground">{k.label}</p>
                  <p className="text-xs text-graphite">{k.description}</p>
                </div>
                <Segmented<EmailKindRule>
                  aria-label={k.label}
                  value={k.rule}
                  onChange={v => mutate({ email_kinds: { [k.kind]: v === 'due48' ? null : v === 'always' } })}
                  options={[
                    { value: 'due48', label: 'Si vence en 48 h' },
                    { value: 'always', label: 'Todas' },
                    { value: 'off', label: 'Nunca' },
                  ]}
                />
              </div>
            ) : (
              <ListRow
                key={k.kind}
                title={k.label}
                subtitle={k.description}
                trailing={
                  <IosSwitch
                    label={k.label}
                    checked={k.rule !== 'off'}
                    onChange={v => { haptic(); mutate({ email_kinds: { [k.kind]: v } }) }}
                  />
                }
              />
            ),
          )}
        </InsetGroup>
      )}

      <InsetGroup footer="Te mandamos un correo de ejemplo para comprobar que llega y cómo se ve. Hasta 3 por hora.">
        <ListRow
          title={test.isPending ? 'Enviando…' : 'Enviarme un correo de prueba'}
          onClick={() => { if (!test.isPending) { haptic(); test.mutate() } }}
        />
      </InsetGroup>
    </div>
  )
}
