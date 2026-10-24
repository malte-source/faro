'use client'

import dynamic from 'next/dynamic'
import { BlockSkeleton } from '@/components/common/lazy-skeleton'

export const ProjectGantt = dynamic(() => import('./project-gantt').then(m => m.ProjectGantt), {
  ssr: false,
  loading: () => <BlockSkeleton className="h-96" label="Cargando el Gantt…" />,
})
