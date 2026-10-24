'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  Mail, Copy, RotateCcw, Power, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle, Inbox,
} from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'

interface Props {
  projectId: string
  inboundToken: string | null
}

/**
 * Email-to-task card — surfaces the webhook URL the user plugs into Mailgun /
 * Postmark / Zapier / etc. Each project has its own token; rotating it
 * invalidates the previous URL.
 *
 * The flow for the user:
 *   1. Click "Activar email-to-task" → token generated, URL revealed.
 *   2. Copy the URL.
 *   3. In their email service of choice, configure a route that POSTs
 *      received emails to that URL. (Setup instructions linked.)
 *   4. Forward / send an email to that route's address → task appears here.
 */
export function ProjectEmailInbox({ projectId, inboundToken }: Props) {
  const [showLog, setShowLog] = useState(false)
  const utils = trpc.useUtils()

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const webhookUrl = inboundToken ? `${baseUrl}/api/email/inbound/${inboundToken}` : null

  const generate = trpc.projects.regenerateInboundToken.useMutation({
    onSuccess: () => { toast.success('Email-to-task activado'); utils.projects.invalidate() },
    onError: (e) => toast.error('No se pudo activar', e.message),
  })
  const disable = trpc.projects.disableInbound.useMutation({
    onSuccess: () => { toast.success('Email-to-task desactivado'); utils.projects.invalidate() },
    onError: (e) => toast.error('No se pudo desactivar', e.message),
  })

  const { data: emails } = trpc.projects.inboundEmails.useQuery(
    { projectId, limit: 30 },
    { enabled: showLog && !!inboundToken },
  )

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <Mail className="h-5 w-5 text-signal-ink" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Email → Tarea</h3>
          <p className="text-xs text-graphite">
            Forward un email a este proyecto y se convierte en tarea automáticamente.
            Subject = título, body = descripción, adjuntos se listan.
          </p>
        </div>
      </div>

      {!inboundToken ? (
        <div className="mt-4 rounded-lg border border-dashed border-stone bg-mist/40 p-4 text-center dark:border-ink-body dark:bg-night-700/40">
          <p className="text-xs text-graphite">
            Email-to-task no está activo para este proyecto.
          </p>
          <button
            onClick={() => generate.mutate({ projectId })}
            disabled={generate.isPending}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            <Mail className="h-3.5 w-3.5" />
            {generate.isPending ? 'Generando…' : 'Activar email-to-task'}
          </button>
        </div>
      ) : (
        <>
          {/* Webhook URL */}
          <div className="mt-4 rounded-lg bg-mist p-3 dark:bg-night-700/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-graphite mb-1">
              Webhook URL (no compartir públicamente)
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-white px-2 py-1.5 font-mono text-[11px] dark:bg-night">
                {webhookUrl}
              </code>
              <button
                onClick={() => {
                  if (webhookUrl) {
                    navigator.clipboard.writeText(webhookUrl)
                    toast.success('URL copiada')
                  }
                }}
                className="rounded p-1.5 text-graphite hover:bg-white hover:text-signal-ink dark:hover:bg-ink-body"
                title="Copiar"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Setup instructions */}
          <details className="mt-3 rounded-lg border border-stone-100 px-3 py-2 dark:border-night-700">
            <summary className="cursor-pointer text-xs font-medium text-ink-body hover:text-foreground dark:text-stone">
              ¿Cómo lo conecto a mi email?
            </summary>
            <div className="mt-3 space-y-3 text-[11px] text-graphite dark:text-graphite">
              <SetupOption
                title="Mailgun (recomendado, gratis hasta 5k emails/mes)"
                steps={[
                  'Crea cuenta en mailgun.com y verifica un dominio (ej: mail.tudominio.com).',
                  'En "Routes" → "Create Route" → expresión "match_recipient(\'inbound@mail.tudominio.com\')".',
                  'Acción: "forward(\'' + (webhookUrl ?? '') + '\')".',
                  'Envía o reenvía un email a inbound@mail.tudominio.com — Mailgun POSTea a nuestro webhook automáticamente.',
                ]}
              />
              <SetupOption
                title="Zapier / Make.com (sin servidor propio)"
                steps={[
                  'En Zapier crea un Zap: Trigger = Email Parser by Zapier (te dan una dirección @robot.zapier.com).',
                  'Action = Webhook POST → URL: el webhook arriba, body en JSON con campos from, subject, body.',
                  'Forward / send mails a tu dirección de Zapier — se transforman en tareas.',
                ]}
              />
              <SetupOption
                title="Postmark Inbound"
                steps={[
                  'Crear servidor Inbound en Postmark → te da una dirección @inbound.postmarkapp.com.',
                  'Configura InboundHookUrl = el webhook arriba.',
                  'Mandar email → Postmark POSTea JSON con { From, Subject, TextBody, HtmlBody, Attachments }.',
                ]}
              />
              <SetupOption
                title="Custom script / curl test"
                steps={[
                  'Envía un POST con curl o cualquier script:',
                  '`curl -X POST ' + (webhookUrl ?? '') + ' -H "Content-Type: application/json" -d \'{"from":"vos@test.com","subject":"Prueba","body":"Cuerpo"}\'`',
                  'Si todo OK, ves una tarea en la lista en segundos.',
                ]}
              />
            </div>
          </details>

          {/* Actions */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={async () => {
                const ok = await confirmAction({
                  title: 'Regenerar URL del webhook',
                  description: 'El link anterior deja de funcionar. Si lo tenías configurado en Mailgun/Zapier, hay que actualizarlo allá.',
                  variant: 'warning',
                  confirmLabel: 'Regenerar',
                })
                if (ok) generate.mutate({ projectId })
              }}
              className="inline-flex items-center gap-1 rounded-md border border-stone px-2 py-1 text-[11px] text-graphite hover:bg-mist dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
            >
              <RotateCcw className="h-3 w-3" />
              Regenerar URL
            </button>
            <button
              onClick={async () => {
                const ok = await confirmAction({
                  title: 'Desactivar email-to-task',
                  description: 'Los emails enviados al webhook serán rechazados. Los emails ya recibidos y sus tareas se mantienen.',
                  variant: 'destructive',
                  confirmLabel: 'Desactivar',
                })
                if (ok) disable.mutate({ projectId })
              }}
              className="inline-flex items-center gap-1 rounded-md border border-stone px-2 py-1 text-[11px] text-graphite hover:bg-danger-wash hover:text-danger dark:border-ink-body dark:hover:bg-danger/40"
            >
              <Power className="h-3 w-3" />
              Desactivar
            </button>
            <button
              onClick={() => setShowLog(s => !s)}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-night hover:bg-signal-wash dark:text-signal dark:hover:bg-signal/30"
            >
              <Inbox className="h-3 w-3" />
              Ver emails recibidos
              {showLog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {/* Log */}
          {showLog && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-stone-100 dark:border-night-700">
              {!emails?.length ? (
                <p className="px-3 py-6 text-center text-xs text-graphite">
                  Sin emails recibidos todavía. Envía un test con curl o configura tu servicio de email.
                </p>
              ) : (
                <ul className="divide-y divide-stone-100 dark:divide-night-700">
                  {emails.map(e => {
                    const task = (e as unknown as { task: { id: string; title: string; status: string } | null }).task
                    return (
                      <li key={e.id} className="px-3 py-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink-body dark:text-stone">{e.subject ?? '(sin asunto)'}</p>
                            <p className="text-[10px] text-graphite truncate">
                              De: {e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email ?? 'desconocido'}
                            </p>
                            <p className="text-[10px] text-graphite">{new Date(e.received_at).toLocaleString('es-AR')}</p>
                          </div>
                          {task ? (
                            <span className="inline-flex items-center gap-1 rounded bg-success-wash px-1.5 py-0.5 text-[9px] font-semibold text-success dark:bg-success/40 dark:text-success/50">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Tarea creada
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-signal-wash px-1.5 py-0.5 text-[9px] font-semibold text-signal-ink dark:bg-signal/40 dark:text-signal/50"
                              title={e.rejection_reason ?? undefined}
                            >
                              <AlertCircle className="h-2.5 w-2.5" /> Rechazado
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SetupOption({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-md border border-stone-100 bg-white p-2 dark:border-ink-body dark:bg-night-700">
      <p className="font-semibold text-ink-body dark:text-stone mb-1.5">{title}</p>
      <ol className="ml-3 list-decimal space-y-1 text-graphite dark:text-graphite">
        {steps.map((s, i) => (
          <li key={i}>
            {/* Render inline code blocks (backtick-wrapped) */}
            {s.split(/(`[^`]+`)/).map((part, idx) =>
              part.startsWith('`') && part.endsWith('`') ? (
                <code key={idx} className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[10px] dark:bg-night">
                  {part.slice(1, -1)}
                </code>
              ) : <span key={idx}>{part}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
