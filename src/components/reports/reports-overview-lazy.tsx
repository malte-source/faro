'use client'

import dynamic from 'next/dynamic'
import { ReportsSkeleton } from '@/components/common/lazy-skeleton'

// The report charts pull in recharts; load them after the page shell and the lighter weekly widgets.
export const ReportsOverview = dynamic(() => import('./reports-overview').then(m => m.ReportsOverview), {
  ssr: false,
  loading: () => <ReportsSkeleton />,
})
