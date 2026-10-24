'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'

/** In grupo mode the home is "Hoy", not the executive dashboard. */
export function GroupHomeRedirect() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })

  useEffect(() => {
    if (me?.groupMode && pathname === '/dashboard') router.replace('/dashboard/hoy')
  }, [me?.groupMode, pathname, router])

  return null
}
