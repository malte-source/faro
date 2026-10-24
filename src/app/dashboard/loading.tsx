import { FaroMark } from '@/components/brand/logo'

/**
 * Loading state shown automatically by Next.js while the dashboard layout
 * is preparing (RSC waterfall, auth check, etc.).
 *
 * Brand-aligned: flat Noche background (no gradients — out of brand), the
 * Faro lighthouse mark with a soft pulsing halo. Keeps the visual chain
 * unbroken between login splash → loading → dashboard so the user never
 * sees a white flash.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A1A26] relative overflow-hidden">
      {/* Bottom Google-color ribbon to match login + brand mark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-90"
        style={{
          background:
            'linear-gradient(90deg, #4285F4 0%, #34A853 33%, #FBBC05 66%, #EA4335 100%)',
          clipPath: 'polygon(0 60%, 100% 30%, 100% 100%, 0 100%)',
        }}
      />

      {/* Pulsing lighthouse mark */}
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="relative">
          {/* Pulse halo */}
          <div
            aria-hidden
            className="absolute inset-0 -m-6 animate-ping rounded-full bg-signal/15 [animation-duration:2.4s]"
          />
          <FaroMark size={104} />
        </div>
        <div className="text-center">
          <p className="font-display text-2xl font-extrabold tracking-[-0.03em] text-mist">Faro</p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] font-mono text-signal">
            Cargando…
          </p>
        </div>
      </div>
    </div>
  )
}
