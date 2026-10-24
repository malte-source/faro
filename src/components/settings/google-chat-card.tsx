'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { MessageSquare, ExternalLink, Check, AlertTriangle } from 'lucide-react'

/**
 * Settings card to configure the org's Google Chat incoming webhook.
 * Pasted URL goes straight to organizations.google_chat_webhook_url.
 *
 * UX:
 *   - Status pill at top: configured / not configured
 *   - Input + Save button
 *   - "Enviar test" button only enabled when configured (server returns 'configured' boolean)
 *   - Link to Google docs for how to create a webhook
 */
export function GoogleChatCard() {
  const utils = trpc.useUtils()
  const { data: status, isLoading } = trpc.chatNotifications.status.useQuery()

  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState(false)
  const [tested, setTested] = useState<'ok' | 'err' | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => { setTested(null) }, [url])

  const save = trpc.chatNotifications.setWebhook.useMutation({
    onSuccess: () => {
      utils.chatNotifications.status.invalidate()
      setSaved(true)
      setUrl('')
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (e) => setErrorMsg(e.message),
  })

  const sendTest = trpc.chatNotifications.sendTest.useMutation({
    onSuccess: () => setTested('ok'),
    onError: (e) => { setTested('err'); setErrorMsg(e.message) },
  })

  const remove = trpc.chatNotifications.setWebhook.useMutation({
    onSuccess: () => utils.chatNotifications.status.invalidate(),
  })

  return (
    <div className="rounded-xl border border-stone bg-white p-4 md:p-6 dark:border-night-700 dark:bg-night">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <MessageSquare className="h-5 w-5 text-signal-ink" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-night dark:text-stone-100">Google Chat</h3>
            {!isLoading && status?.configured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-wash px-2 py-0.5 text-[10px] font-medium text-success dark:bg-success/40 dark:text-success/50">
                <Check className="h-2.5 w-2.5" /> Conectado
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-graphite">
            Recibe en tu espacio de Google Chat alertas de nuevos proyectos, deadlines próximos y el digest semanal.
          </p>

          {/* Currently configured (masked) */}
          {status?.configured && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-mist px-3 py-2 dark:bg-night-700">
              <code className="flex-1 truncate text-[11px] text-graphite dark:text-stone">{status.preview}</code>
              <button
                onClick={() => sendTest.mutate()}
                disabled={sendTest.isPending}
                className="rounded-md border border-stone bg-white px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-mist disabled:opacity-50 dark:border-ink-body dark:bg-night dark:text-stone dark:hover:bg-night-700"
              >
                {sendTest.isPending ? 'Enviando…' : 'Enviar test'}
              </button>
              <button
                onClick={() => remove.mutate({ url: '' })}
                className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger-wash dark:hover:bg-danger/40"
              >
                Desconectar
              </button>
            </div>
          )}

          {/* Form to set/replace */}
          <div className="mt-3 space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-graphite">
              {status?.configured ? 'Reemplazar webhook' : 'Pega la URL del webhook'}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://chat.googleapis.com/v1/spaces/AAAAA/messages?key=…&token=…"
                className="flex-1 rounded-lg border border-stone px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal dark:border-ink-body dark:bg-night-700"
              />
              <button
                onClick={() => { setErrorMsg(null); save.mutate({ url: url.trim() }) }}
                disabled={!url.trim() || save.isPending}
                className="rounded-lg bg-night px-4 py-2 text-sm font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
              >
                Guardar
              </button>
            </div>

            {saved && <p className="text-xs text-success">Guardado ✓</p>}
            {tested === 'ok' && <p className="text-xs text-success">Mensaje de prueba enviado ✓ — revisa el espacio de Chat.</p>}
            {(errorMsg || tested === 'err') && (
              <p className="flex items-start gap-1 text-xs text-danger">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {errorMsg ?? 'Error al enviar test.'}
              </p>
            )}
          </div>

          {/* Help link */}
          <a
            href="https://developers.google.com/workspace/chat/quickstart/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-xs text-signal-ink hover:text-foreground"
          >
            ¿Cómo crear un webhook en Google Chat?
            <ExternalLink className="h-3 w-3" />
          </a>

          {/* Notification preferences — only shown if a webhook is configured */}
          {status?.configured && status.prefs && (
            <NotificationPrefsToggles prefs={status.prefs} />
          )}
        </div>
      </div>
    </div>
  )
}

const PREF_LABELS: { key: keyof typeof PREF_LABEL_MAP; label: string; help: string }[] = [
  { key: 'chat_new_project',     label: 'Nuevo proyecto',         help: 'Card al crear cualquier proyecto.' },
  { key: 'chat_mentions',        label: 'Menciones en comentarios', help: 'Comentarios que contengan @.' },
  { key: 'chat_deadlines',       label: 'Alertas de vencimiento',  help: 'Cron diario 9am: proyectos vencen 48hs + tareas vencen hoy.' },
  { key: 'chat_weekly_digest',   label: 'Digest semanal',          help: 'Cron lunes 8am: resumen Gemini del portfolio.' },
  { key: 'chat_recurring_created', label: 'Tareas recurrentes',    help: 'Cada vez que el cron materializa una tarea recurrente. (Por defecto off.)' },
] as const

const PREF_LABEL_MAP = {
  chat_new_project: '', chat_mentions: '', chat_deadlines: '', chat_weekly_digest: '', chat_recurring_created: '',
} as const

function NotificationPrefsToggles({ prefs }: { prefs: Record<string, boolean> }) {
  const utils = trpc.useUtils()
  const setPref = trpc.chatNotifications.setPref.useMutation({
    onSuccess: () => utils.chatNotifications.status.invalidate(),
  })

  return (
    <div className="mt-5 border-t border-stone-100 pt-4 dark:border-night-700">
      <p className="mb-2 text-xs font-semibold text-ink-body dark:text-stone">Notificaciones que recibes en Chat</p>
      <ul className="space-y-1.5">
        {PREF_LABELS.map(p => {
          const enabled = prefs[p.key] !== false
          return (
            <li key={p.key} className="flex items-center justify-between gap-3 rounded-md py-1">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-night-700 dark:text-stone">{p.label}</p>
                <p className="text-[10px] text-graphite">{p.help}</p>
              </div>
              <button
                onClick={() => setPref.mutate({ key: p.key as 'chat_new_project' | 'chat_mentions' | 'chat_deadlines' | 'chat_weekly_digest' | 'chat_recurring_created', enabled: !enabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                  enabled ? 'bg-night' : 'bg-stone dark:bg-ink-body'
                }`}
                aria-pressed={enabled}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                    enabled ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
