'use client'

import dynamic from 'next/dynamic'
import { ChartsSkeleton } from '@/components/common/lazy-skeleton'

// recharts (~100 KB) is only needed once the charts paint: keep it out of the Inicio entry bundle.
export const DashboardCharts = dynamic(() => import('./dashboard-charts').then(m => m.DashboardCharts), {
  ssr: false,
  loading: () => <ChartsSkeleton />,
})
