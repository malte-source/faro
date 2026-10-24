import Link from 'next/link'
import { Mic } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Primary "Capturar" action for the desktop header — the single Señal-filled
 * button of the screen. Goes to the capture workspace (/dashboard/capturar).
 */
export function CaptureButton({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard/capturar"
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-signal px-4 text-sm font-semibold text-night transition-colors hover:bg-[#F0A30F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2',
        className,
      )}
    >
      <Mic className="h-4 w-4" />
      Capturar
    </Link>
  )
}
