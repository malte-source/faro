'use client'

import Link from 'next/link'
import { Camera } from 'lucide-react'
import { QuickAddBar } from '@/components/layout/quick-add-bar'
import { BottomSheet } from '@/components/mobile/bottom-sheet'

/**
 * Sheet opened by a tap on the centre button (grupo mode): the one-line task
 * input with its "Faro entiende:" chips, plus the way into the full capture
 * screen for photo, video or pasted text.
 */
export function MobileCreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Nueva tarea">
      <div className="-mx-4">
        <QuickAddBar embedded onCreated={onClose} />
      </div>
      <Link
        href="/dashboard/capturar"
        onClick={onClose}
        className="mt-1 flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface text-[15px] font-medium text-foreground active:bg-border-soft"
      >
        <Camera className="h-[18px] w-[18px]" />
        Foto, video o texto pegado
      </Link>
      <p className="mt-3 pb-2 text-center text-xs text-graphite">Mantén apretado el botón de Señal para grabar un audio.</p>
    </BottomSheet>
  )
}
