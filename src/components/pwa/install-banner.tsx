'use client'

import { Download, X } from 'lucide-react'
import { usePwaInstall } from '@/hooks/use-pwa-install'
import { FaroMark } from '@/components/brand/logo'

/**
 * Shows a floating install card when the browser fires `beforeinstallprompt`.
 * Positioned above the mobile bottom nav on small screens,
 * bottom-right on desktop.
 */
export function PwaInstallBanner() {
  const { canInstall, install, dismiss } = usePwaInstall()

  if (!canInstall) return null

  return (
    <div className="fixed bottom-[4.5rem] left-3 right-3 z-50 md:bottom-5 md:left-auto md:right-5 md:w-72 animate-in slide-in-from-bottom-4 duration-300">
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-xl shadow-signal/20 ring-1 ring-inset ring-white/60">
        {/* Header */}
        <div className="flex items-start gap-3">
          <FaroMark size={40} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Instalar Faro</p>
            <p className="text-xs text-graphite mt-0.5 leading-snug">
              Acceso instantáneo desde tu pantalla de inicio, sin abrir el navegador.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 rounded-lg p-1 text-stone transition-colors hover:bg-border-soft hover:text-graphite"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={install}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-night px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-night-700 active:scale-95"
          >
            <Download className="h-3.5 w-3.5" />
            Instalar
          </button>
          <button
            onClick={dismiss}
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-graphite transition-colors hover:bg-background hover:text-body"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  )
}
