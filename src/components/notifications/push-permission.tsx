'use client'

import type { ReactNode } from 'react'
import { BellRing, BellOff, CheckCircle2, Loader2, Share, Smartphone, SquarePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { usePush, type PushState } from '@/components/notifications/use-push'

function Shell({ tone, icon, title, children }: { tone: 'neutral' | 'signal' | 'success' | 'danger'; icon: ReactNode; title: string; children?: ReactNode }) {
  const tones = {
    neutral: 'bg-border-soft text-foreground',
    signal: 'bg-signal text-night',
    success: 'bg-success text-white',
    danger: 'bg-danger text-white',
  }
  return (
    <div className="rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] [&>svg]:h-5 [&>svg]:w-5', tones[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-foreground">{title}</h3>
          <div className="mt-1 space-y-3 text-[14px] leading-relaxed text-graphite">{children}</div>
        </div>
      </div>
    </div>
  )
}

function Steps({ items }: { items: Array<{ icon: ReactNode; text: ReactNode }> }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 text-foreground">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-border-soft text-[12px] font-bold">{i + 1}</span>
          <span className="flex items-center gap-1.5">{it.text}{it.icon}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * "Avisos en este dispositivo". One card, every state explained in plain words:
 * server not ready, unsupported, iPhone that must install first, blocked, off, on.
 * The permission prompt only ever appears from the button's tap.
 */
export function PushPermissionCard({ className }: { className?: string }) {
  const { state, busy, devices, enable, disable, sendTest, testing } = usePush()
  const body = (s: PushState) => {
    switch (s) {
      case 'loading':
        return <div className="h-24 animate-pulse rounded-[14px] bg-border-soft" aria-busy />
      case 'server-off':
        return (
          <Shell tone="neutral" icon={<BellOff />} title="Los avisos al teléfono aún no están activos">
            <p>Estamos terminando de configurarlos en el servidor. Mientras tanto, lo que te pasa sigue llegando a tu bandeja dentro de Faro.</p>
          </Shell>
        )
      case 'unsupported':
        return (
          <Shell tone="neutral" icon={<BellOff />} title="Este navegador no admite avisos">
            <p>Prueba con Chrome en Android, o instala Faro en tu iPhone. En un computador usa Chrome, Edge o Firefox actualizados.</p>
          </Shell>
        )
      case 'needs-install':
        return (
          <Shell tone="signal" icon={<Smartphone />} title="En iPhone, primero instala Faro">
            <p>Apple solo permite avisos a las apps instaladas en la pantalla de inicio. Son tres toques:</p>
            <Steps
              items={[
                { text: <>En Safari, toca <strong>Compartir</strong></>, icon: <Share className="h-4 w-4 text-graphite" /> },
                { text: <>Elige <strong>Añadir a pantalla de inicio</strong></>, icon: <SquarePlus className="h-4 w-4 text-graphite" /> },
                { text: <>Abre Faro desde su ícono y vuelve a esta pantalla</>, icon: null },
              ]}
            />
          </Shell>
        )
      case 'denied':
        return (
          <Shell tone="danger" icon={<BellOff />} title="Bloqueaste los avisos de Faro">
            <p>Para volver a activarlos hay que permitirlos en el sistema:</p>
            <ul className="list-disc space-y-1 pl-5 text-foreground">
              <li><strong>iPhone:</strong> Ajustes → Notificaciones → Faro → Permitir.</li>
              <li><strong>Android:</strong> mantén apretado el ícono de Faro → Información → Notificaciones → Permitir.</li>
              <li><strong>Computador:</strong> toca el candado junto a la dirección → Notificaciones → Permitir.</li>
            </ul>
            <p>Después vuelve aquí.</p>
          </Shell>
        )
      case 'off':
        return (
          <Shell tone="signal" icon={<BellRing />} title="Entérate sin abrir Faro">
            <p>Te avisamos cuando te asignan una tarea, te mencionan o te piden revisar algo. Nada de ruido: tú eliges qué recibir.</p>
            <Button variant="signal" size="lg" className="w-full md:w-auto" onClick={enable} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              Activar avisos en este dispositivo
            </Button>
          </Shell>
        )
      case 'on':
        return (
          <Shell tone="success" icon={<CheckCircle2 />} title="Avisos activos en este dispositivo">
            <p>{devices > 1 ? `Los recibes en ${devices} dispositivos.` : 'Los recibes en este dispositivo.'} Si algo no llega, envía una prueba.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={sendTest} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                Enviar aviso de prueba
              </Button>
              <Button variant="ghost" onClick={disable} disabled={busy}>Desactivar en este dispositivo</Button>
            </div>
          </Shell>
        )
    }
  }
  return <div className={className}>{body(state)}</div>
}
