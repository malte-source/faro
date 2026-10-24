'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import { trpc } from '@/lib/trpc/client'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/toaster'
import { ConfirmHost } from '@/components/ui/confirm'
import { HelpModal } from '@/components/common/help-modal'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,    // 5 min — avoid unnecessary refetches
        gcTime: 15 * 60 * 1000,      // 15 min in memory cache
        // Retry once on 5xx (transient server error), never on 4xx.
        retry: (failureCount, error) => {
          if (failureCount >= 1) return false
          const status = (error as { data?: { httpStatus?: number } })?.data?.httpStatus
          if (status && status >= 400 && status < 500) return false
          return true
        },
        retryDelay: 1000,
        // Refetch when the user comes back to the tab — cheap way to get
        // "freshness without polling" for the 90% of cases. Combined with
        // staleTime: 5min, this only fires if the data is genuinely stale.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  }))

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/trpc`,
          // Send the browser's detected timezone on every request. Server uses
          // this to auto-populate `users.timezone` on first call and to override
          // a stale stored TZ. Resolved once at link-creation time — if a user
          // physically travels timezones mid-session, they'll get the new TZ on
          // next page load.
          headers() {
            try {
              const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
              return tz ? { 'x-faro-tz': tz } : {}
            } catch {
              return {}
            }
          },
        }),
      ],
    })
  )

  return (
    // SessionProvider is REQUIRED for next-auth/react hooks (useSession in
    // settings, signOut in sidebar/command palette). Without it useSession
    // throws and crashes the whole page client-side.
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            {children}
            <Toaster />
            <ConfirmHost />
            <HelpModal />
          </QueryClientProvider>
        </trpc.Provider>
      </ThemeProvider>
    </SessionProvider>
  )
}
