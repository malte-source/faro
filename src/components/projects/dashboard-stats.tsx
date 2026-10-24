'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderKanban, PlayCircle, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react'

/**
 * Top 4 stat tiles on the dashboard. Each is a tappable link to the filtered
 * projects list ("Retrasados" → `/dashboard/projects?status=delayed`, etc.).
 * Phone: 2×2 tiles with a big Archivo number and an iOS-style press-in.
 */
export function DashboardStats() {
  const { data, isLoading } = trpc.projects.dashboard.useQuery()

  const stats = [
    {
      label: 'Total proyectos',
      value: data?.total ?? 0,
      icon: FolderKanban,
      iconClass: 'bg-signal-wash text-signal-ink dark:bg-signal/15 dark:text-signal',
      href: '/dashboard/projects',
    },
    {
      label: 'En progreso',
      value: data?.active ?? 0,
      icon: PlayCircle,
      iconClass: 'bg-info/10 text-info dark:bg-info/20 dark:text-[#7FB2D6]',
      href: '/dashboard/projects?status=in_progress',
    },
    {
      label: 'Retrasados',
      value: data?.delayed ?? 0,
      icon: AlertTriangle,
      iconClass: 'bg-danger-wash text-danger dark:bg-danger/20 dark:text-[#F08A80]',
      href: '/dashboard/projects?status=delayed',
    },
    {
      label: 'Completados',
      value: data?.completed ?? 0,
      icon: CheckCircle2,
      iconClass: 'bg-success-wash text-success dark:bg-success/20 dark:text-[#5CC9A8]',
      href: '/dashboard/projects?status=completed',
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 pt-4 lg:p-6">
              <Skeleton className="mb-3 h-9 w-9 rounded-[10px]" />
              <Skeleton className="mb-1 h-8 w-12" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {stats.map(({ label, value, icon: Icon, iconClass, href }) => (
        <Link key={label} href={href} className="group block touch-manipulation" aria-label={`${label}: ${value}`}>
          <Card className="relative overflow-hidden transition-all duration-150 active:scale-[0.97] md:hover:-translate-y-0.5 md:hover:shadow-md">
            <CardContent className="p-4 pt-4 lg:p-6">
              <div className="mb-3 flex items-start justify-between">
                <div className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] lg:h-10 lg:w-10 ${iconClass}`}>
                  <Icon className="h-[18px] w-[18px] lg:h-5 lg:w-5" />
                </div>
                <ArrowRight className="hidden h-3.5 w-3.5 text-graphite opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 md:block" />
              </div>
              <p className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-foreground tabular-nums">{value}</p>
              <p className="mt-1.5 text-[12px] text-graphite lg:text-sm">{label}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
