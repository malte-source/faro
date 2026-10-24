'use client'

import dynamic from 'next/dynamic'
import { BlockSkeleton } from '@/components/common/lazy-skeleton'

// The capture screen (recorder, outbox, proposal cards) is the heaviest screen after the editor.
export const CaptureWorkspace = dynamic(() => import('./capture-workspace').then(m => m.CaptureWorkspace), {
  ssr: false,
  loading: () => (
    <div className="flex-1 p-4 md:p-6">
      <BlockSkeleton className="h-64" label="Cargando Capturar…" />
    </div>
  ),
})
