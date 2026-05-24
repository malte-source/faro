import Link from 'next/link'
import { Anchor, WifiOff } from 'lucide-react'

/**
 * Fallback page served by the service worker when the user is offline
 * and the requested page isn't cached.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      {/* Logo */}
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg">
        <Anchor className="h-7 w-7 text-white" />
      </div>

      {/* Icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200">
        <WifiOff className="h-8 w-8 text-slate-400" />
      </div>

      {/* Message */}
      <div className="space-y-2">
        <h1 className="text-xl font-bold text-slate-800">Sin conexión</h1>
        <p className="max-w-xs text-sm text-slate-500">
          Parece que no tenés conexión a internet en este momento. Las páginas que visitaste
          recientemente siguen disponibles desde caché.
        </p>
      </div>

      {/* Action */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-95"
      >
        Ir al Dashboard
      </Link>
    </div>
  )
}
