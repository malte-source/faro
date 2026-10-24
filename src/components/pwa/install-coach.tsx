'use client'

import { useEffect, useState } from 'react'
import { Check, Download, Share, SquarePlus, X } from 'lucide-react'
import { FaroMark } from '@/components/brand/logo'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { Button } from '@/components/ui/button'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { useIsIOS } from './platform'
import { promptInstall, snoozeInstall, useInstall } from './use-install'

/** Wait this long after load before asking: people should see Faro first. */
const ASK_DELAY_MS = 8_000

const BENEFIT = 'Para recibir avisos y grabar sin abrir el navegador.'

function Step({ n, icon, title, hint }: { n: number; icon: React.ReactNode; title: React.ReactNode; hint: string }) {
  return (
    <li className="flex items-center gap-3.5 rounded-[14px] border border-border bg-surface p-3.5">
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-night text-mist dark:bg-border dark:text-foreground">
        {icon}
        <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-signal font-mono text-[11px] font-bold text-night ring-2 ring-background">{n}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-snug text-foreground">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-graphite">{hint}</span>
      </span>
    </li>
  )
}

/**
 * iPhone / iPad: there is no install button in Safari, so we show the three
 * taps. (Since iOS 26 any site added to the Home Screen opens as an app; before
 * that it needs "Abrir como app" enabled in that dialog.)
 */
export function IosInstallSheet({ open, onClose, onLater }: { open: boolean; onClose: () => void; onLater?: () => void }) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Instala Faro en tu iPhone"
      description={BENEFIT}
      footer={
        <div className="flex gap-2">
          {onLater && <Button variant="ghost" className="flex-1" onClick={onLater}>Ahora no</Button>}
          <Button className="flex-1" onClick={onClose}>Listo</Button>
        </div>
      }
    >
      <ol className="space-y-2.5 pb-1 pt-2">
        <Step
          n={1}
          icon={<Share className="h-6 w-6" strokeWidth={1.8} />}
          title={<>Toca <strong>Compartir</strong></>}
          hint="El cuadrado con la flecha hacia arriba, abajo en Safari (en otros navegadores, en el menú ⋯)."
        />
        <Step
          n={2}
          icon={<SquarePlus className="h-6 w-6" strokeWidth={1.8} />}
          title={<>Elige <strong>Añadir a pantalla de inicio</strong></>}
          hint="Desliza la lista hacia arriba si no la ves."
        />
        <Step
          n={3}
          icon={<Check className="h-6 w-6" strokeWidth={2.2} />}
          title={<>Toca <strong>Añadir</strong></>}
          hint="Faro aparece en tu pantalla de inicio como una app más. Ábrela desde ahí."
        />
      </ol>
    </BottomSheet>
  )
}

/**
 * Asks to install Faro, once and politely:
 *   Android / desktop Chromium → a small card with the native "Instalar" button
 *   iPhone / iPad              → a sheet with the three Add-to-Home-Screen taps
 * Silent when already installed, and for 14 days after "Ahora no".
 */
export function InstallCoach() {
  const { canPrompt, installed, snoozed } = useInstall()
  const ios = useIsIOS()
  const [ready, setReady] = useState(false)
  const [iosOpen, setIosOpen] = useState(false)
  const [iosShown, setIosShown] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setReady(true), ASK_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  const eligible = ready && !installed && !snoozed

  // iPhone: open the steps once per page load.
  if (eligible && ios && !iosShown) {
    setIosShown(true)
    setIosOpen(true)
  }

  if (ios) {
    return (
      <IosInstallSheet
        open={iosOpen}
        onClose={() => setIosOpen(false)}
        onLater={() => { snoozeInstall(); setIosOpen(false) }}
      />
    )
  }

  if (!eligible || !canPrompt) return null

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 animate-in slide-in-from-bottom-4 duration-300 md:inset-x-auto md:bottom-5 md:right-5 md:w-80"
      role="dialog"
      aria-label="Instalar Faro"
    >
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_30px_rgba(10,26,38,0.18)]">
        <div className="flex items-start gap-3">
          <FaroMark size={40} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Instalar Faro</p>
            <p className="mt-0.5 text-xs leading-snug text-graphite">{BENEFIT}</p>
          </div>
          <button
            type="button"
            onClick={() => snoozeInstall()}
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-graphite active:bg-border-soft"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" onClick={() => void promptInstall()}>
            <Download className="h-4 w-4" /> Instalar
          </Button>
          <Button variant="ghost" onClick={() => snoozeInstall()}>Ahora no</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * "Más" screen card: install on demand, with no snooze involved.
 * Installed → a confirmation row. Otherwise one tap does the right thing for the platform.
 */
export function InstallCard() {
  const { canPrompt, installed } = useInstall()
  const ios = useIsIOS()
  const [open, setOpen] = useState(false)

  if (installed) {
    return (
      <InsetGroup>
        <ListRow
          leading={<IconTile tone="success"><Check /></IconTile>}
          title="Faro está instalada"
          subtitle="Recibes avisos y grabas sin abrir el navegador."
        />
      </InsetGroup>
    )
  }

  const onTap = () => {
    if (canPrompt) void promptInstall()
    else if (ios) setOpen(true)
  }

  return (
    <>
      <InsetGroup>
        <ListRow
          onClick={canPrompt || ios ? onTap : undefined}
          leading={<IconTile tone="signal"><Download /></IconTile>}
          title="Instalar Faro"
          subtitle={canPrompt || ios ? BENEFIT : 'En el menú del navegador, elige «Instalar» o «Añadir a pantalla de inicio».'}
          chevron={canPrompt || ios}
        />
      </InsetGroup>
      <IosInstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
