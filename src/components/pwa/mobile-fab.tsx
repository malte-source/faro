'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { QuickCreateModal } from '@/components/tasks/quick-create-modal'

/**
 * Floating Action Button visible only on mobile (below md breakpoint).
 * Sits above the bottom navigation bar.
 */
export function MobileFAB() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-[4.5rem] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 shadow-lg shadow-indigo-200 transition-all active:scale-95 hover:bg-indigo-700 md:hidden"
        aria-label="Nueva tarea"
      >
        <Plus className="h-6 w-6 text-white" />
      </button>
      <QuickCreateModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
