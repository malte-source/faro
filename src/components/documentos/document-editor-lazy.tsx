'use client'

import dynamic from 'next/dynamic'
import { BlockSkeleton } from '@/components/common/lazy-skeleton'

// The editor (editor + preview + AI panels, ~30 KB of client code) loads after the shell.
export const DocumentEditor = dynamic(() => import('./document-editor').then(m => m.DocumentEditor), {
  ssr: false,
  loading: () => (
    <div className="flex-1 space-y-3 p-4 md:p-6">
      <BlockSkeleton className="h-10 w-2/3" label="Cargando el documento…" />
      <BlockSkeleton className="h-[60dvh]" label="Cargando el editor…" />
    </div>
  ),
})
