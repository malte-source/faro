'use client'

import { useEffect, useState } from 'react'
import { CloudOff, CloudUpload, FileText, ImageIcon, Mic, RotateCcw, Trash2, Video } from 'lucide-react'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { IconTile, InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { confirmAction } from '@/components/ui/confirm'
import { inFlightIds, outboxRemove, outboxRetryNow, type OutboxItem } from '@/lib/outbox'
import { kickFlush, useOutboxFlusher, useOutboxItems } from '@/components/captura/use-outbox'
import { formatClock } from '@/components/captura/use-recorder'
import { cn } from '@/lib/utils'

const KIND_LABEL = { text: 'Texto', audio: 'Nota de voz', video: 'Video', image: 'Foto' } as const
const KIND_ICON = { text: FileText, audio: Mic, video: Video, image: ImageIcon } as const

function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  return online
}

/** A ticking clock for relative times and backoff countdowns (state, not Date.now() in render). */
function useNow(active: boolean) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, 5_000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [active])
  return now
}

function ago(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000))
  if (s < 60) return 'hace un momento'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}

function titleOf(item: OutboxItem): string {
  if (item.kind === 'text') {
    const t = (item.text ?? '').replace(/\s+/g, ' ').trim()
    return t ? `“${t.length > 38 ? `${t.slice(0, 38)}…` : t}”` : 'Texto'
  }
  const base = KIND_LABEL[item.kind]
  return item.kind === 'audio' && item.durationSec ? `${base} · ${formatClock(item.durationSec)}` : base
}

function statusOf(item: OutboxItem, now: number, online: boolean, sending: boolean): { text: string; tone: 'danger' | 'muted' | 'ok' } {
  if (item.failed) return { text: `No se pudo enviar${item.lastError ? ` · ${item.lastError}` : ''}`, tone: 'danger' }
  if (sending) return { text: 'Enviando…', tone: 'ok' }
  if (!online) return { text: 'Esperando conexión', tone: 'muted' }
  const wait = item.nextAttemptAt - now
  if (now > 0 && wait > 1_500) return { text: `Reintenta en ${wait < 60_000 ? `${Math.ceil(wait / 1000)} s` : `${Math.ceil(wait / 60_000)} min`}`, tone: 'muted' }
  return { text: 'En cola', tone: 'muted' }
}

/**
 * Mounts the outbox flusher (renders nothing). Put it once near the root of the
 * signed-in app so queued captures go out even if the person never opens Capturar.
 */
export function OutboxFlusher() {
  useOutboxFlusher()
  return null
}

/**
 * "2 pendientes de enviar" — the captures saved on this phone that haven't reached
 * Faro yet (no signal, server hiccup). Tap for the list: retry now or discard.
 * Renders nothing when the outbox is empty. Also runs the flusher.
 */
export function OutboxChip({ className }: { className?: string }) {
  useOutboxFlusher()
  const items = useOutboxItems()
  const online = useOnline()
  const [open, setOpen] = useState(false)
  const now = useNow(items.length > 0)

  if (items.length === 0) return null
  const failed = items.filter(i => i.failed).length
  const sending = inFlightIds()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 w-fit items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors active:scale-[0.98]',
          failed > 0
            ? 'border-danger/40 bg-danger-wash text-danger dark:bg-danger/15'
            : 'border-signal/50 bg-signal-wash text-signal-ink dark:bg-signal/10 dark:text-signal',
          className,
        )}
        aria-label="Ver capturas pendientes de enviar"
      >
        {online ? <CloudUpload className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
        {items.length === 1 ? '1 pendiente de enviar' : `${items.length} pendientes de enviar`}
        {failed > 0 && <span className="text-xs opacity-80">· {failed} sin enviar</span>}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Pendientes de enviar"
        description={online ? 'Guardadas en este teléfono. Se envían solas; también puedes reintentar.' : 'Sin conexión: se enviarán solas cuando vuelva.'}
      >
        <div className="pb-2 pt-1">
          <InsetGroup>
            {items.map(item => {
              const Icon = KIND_ICON[item.kind]
              const st = statusOf(item, now, online, sending.has(item.clientId))
              return (
                <ListRow
                  key={item.clientId}
                  leading={<IconTile tone={item.failed ? 'danger' : 'neutral'}><Icon /></IconTile>}
                  title={titleOf(item)}
                  subtitle={
                    <span className={cn(st.tone === 'danger' && 'text-danger', st.tone === 'ok' && 'text-signal-ink')}>
                      {st.text} · {ago(item.createdAt, now)}
                    </span>
                  }
                  trailing={
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Reintentar ahora"
                        onClick={() => { void outboxRetryNow(item.clientId).then(() => kickFlush()) }}
                        className="flex h-10 w-10 items-center justify-center rounded-full text-foreground active:bg-border-soft"
                      >
                        <RotateCcw className="h-[18px] w-[18px]" />
                      </button>
                      <button
                        type="button"
                        aria-label="Descartar"
                        onClick={async () => {
                          const ok = await confirmAction({
                            title: 'Descartar esta captura',
                            description: 'Se borra de tu teléfono y no se envía a Faro.',
                            variant: 'destructive',
                            confirmLabel: 'Descartar',
                          })
                          if (ok) await outboxRemove(item.clientId)
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-full text-danger active:bg-danger-wash"
                      >
                        <Trash2 className="h-[18px] w-[18px]" />
                      </button>
                    </span>
                  }
                />
              )
            })}
          </InsetGroup>
        </div>
      </BottomSheet>
    </>
  )
}
