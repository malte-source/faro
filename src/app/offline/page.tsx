'use client'

import Link from 'next/link'
import { WifiOff, RotateCcw } from 'lucide-react'
import { FaroMark } from '@/components/brand/logo'

/**
 * Fallback page served by the service worker when the user is offline
 * and the requested page isn't cached. Flat Noche — no gradients.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#0A1A26] px-6 text-center">
      <FaroMark plain size={56} />

      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-night-700 ring-2 ring-signal/30">
        <WifiOff className="h-7 w-7 text-signal" />
      </div>

      <div className="max-w-sm space-y-2">
        <h1 className="font-display text-2xl font-bold text-mist">Sin conexión</h1>
        <p className="text-sm text-[#9DB0BC]">
          Sin conexión. Los cambios se guardan cuando vuelvas a estar en línea.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-[10px] bg-signal px-5 py-2.5 text-sm font-semibold text-night transition active:scale-95 hover:bg-[#F0A30F]"
        >
          <RotateCcw className="h-4 w-4" />
          Reintentar
        </button>
        <Link href="/dashboard" className="text-xs text-[#9DB0BC] underline-offset-2 hover:underline">
          Ir al Dashboard cacheado
        </Link>
      </div>

      <p className="absolute bottom-6 text-[10px] uppercase tracking-widest text-[#6E8290] font-mono">
        Faro · Luz sobre el proyecto
      </p>
    </div>
  )
}
