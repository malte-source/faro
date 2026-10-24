import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/layout/sidebar'
import { PwaInstallBanner } from '@/components/pwa/install-banner'
import { TabBar } from '@/components/mobile/tab-bar'
import { ScrollTracker } from '@/components/mobile/scroll-tracker'
import { PullToRefresh } from '@/components/mobile/pull-to-refresh'
import { CommandPalette } from '@/components/command/command-palette'
import { OnboardingTour } from '@/components/onboarding/onboarding-tour'
import { QuickAddBar } from '@/components/layout/quick-add-bar'
import { GroupHomeRedirect } from '@/components/layout/group-home-redirect'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Sidebar — visible on md+ */}
      <div className="hidden md:flex">
        <Sidebar
          userName={session.user.name}
          userEmail={session.user.email}
          userAvatar={session.user.image}
        />
      </div>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* One-line task creation (grupo mode only; renders nothing otherwise) */}
        <div className="hidden md:block">
          <QuickAddBar />
        </div>
        <GroupHomeRedirect />
        {/* Page content — bottom padding for mobile nav */}
        <div className="flex flex-1 flex-col overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
      </main>

      {/* Mobile chrome: tab bar with the raised capture button, large-title scroll tracking, pull-to-refresh */}
      <TabBar />
      <ScrollTracker />
      <PullToRefresh />

      {/* PWA install prompt — shown when browser fires beforeinstallprompt */}
      <PwaInstallBanner />

      {/* Command palette — Cmd+K */}
      <CommandPalette />

      {/* Onboarding tour — shows once for new users */}
      <OnboardingTour />
    </div>
  )
}
