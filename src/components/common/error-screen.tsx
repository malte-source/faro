import Link from 'next/link'
import { FaroMark } from '@/components/brand/logo'
import { cn } from '@/lib/utils'

interface ErrorScreenProps {
  title: string
  description: string
  /** Opaque server-side error id (never the message or stack) so a report can be traced in the logs. */
  digest?: string
  /** Present → "Intentar de nuevo" is the primary action; absent → "Volver al inicio" is. */
  onRetry?: () => void
  /** Inside the dashboard layout (sidebar/tab bar stay visible) instead of a full page. */
  inline?: boolean
  homeHref?: string
}

/**
 * Faro's voice for failure: calm, short, one clear action, nothing technical on
 * screen. Theme-aware (Noche in dark) and sized for a phone first. Server-safe:
 * the retry handler is passed in by the client error boundaries.
 */
export function ErrorScreen({ title, description, digest, onRetry, inline = false, homeHref = '/dashboard' }: ErrorScreenProps) {
  const primary =
    'inline-flex h-12 w-full items-center justify-center rounded-[12px] bg-signal px-5 text-[15px] font-semibold text-night transition-colors hover:bg-[#F0A30F] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-background'
  const secondary =
    'inline-flex h-11 w-full items-center justify-center rounded-[12px] text-sm font-medium text-graphite transition-colors hover:text-foreground active:bg-border-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal'

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center justify-center bg-background px-6 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]',
        inline ? 'min-h-[60dvh] flex-1' : 'min-h-dvh',
      )}
    >
      <div className="w-full max-w-sm text-center">
        <FaroMark size={44} className="mx-auto" />
        <h1 className="mt-6 font-display text-2xl font-extrabold tracking-[-0.03em] text-foreground">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-graphite">{description}</p>
        {digest && (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-graphite">Código {digest}</p>
        )}
        <div className="mt-8 flex flex-col gap-2">
          {onRetry ? (
            <>
              <button type="button" onClick={onRetry} className={primary}>Intentar de nuevo</button>
              <Link href={homeHref} className={secondary}>Volver al inicio</Link>
            </>
          ) : (
            <Link href={homeHref} className={primary}>Volver al inicio</Link>
          )}
        </div>
      </div>
    </div>
  )
}
