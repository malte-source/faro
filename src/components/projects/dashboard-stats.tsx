'use client'

import { trpc } from '@/lib/trpc/client'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderKanban, PlayCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'

export function DashboardStats() {
  const { data, isLoading } = trpc.projects.dashboard.useQuery()

  const stats = [
    {
      label: 'Total proyectos',
      value: data?.total ?? 0,
      icon: FolderKanban,
      iconClass: 'bg-indigo-100 text-indigo-600',
      trend: undefined,
    },
    {
      label: 'En progreso',
      value: data?.active ?? 0,
      icon: PlayCircle,
      iconClass: 'bg-blue-100 text-blue-600',
      trend: undefined,
    },
    {
      label: 'Retrasados',
      value: data?.delayed ?? 0,
      icon: AlertTriangle,
      iconClass: 'bg-orange-100 text-orange-600',
      trend: undefined,
    },
    {
      label: 'Completados',
      value: data?.completed ?? 0,
      icon: CheckCircle2,
      iconClass: 'bg-green-100 text-green-600',
      trend: undefined,
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-10 w-10 rounded-lg mb-4" />
              <Skeleton className="h-7 w-16 mb-1" />
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map(({ label, value, icon: Icon, iconClass }) => (
        <Card key={label}>
          <CardContent className="p-6">
            <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${iconClass}`}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
