'use client'

import { Anchor, Download, X } from 'lucide-react'
import { usePwaInstall } from '@/hooks/use-pwa-install'

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
      <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-xl shadow-indigo-100/50 ring-1 ring-inset ring-white/60">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 shadow-sm">
            <Anchor className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">Instalar Faro</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">
              Acceso instantáneo desde tu pantalla de inicio, sin abrir el navegador.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 rounded-lg p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={install}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-95"
          >
            <Download className="h-3.5 w-3.5" />
            Instalar
          </button>
          <button
            onClick={dismiss}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  )
}
