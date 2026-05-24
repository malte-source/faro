import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { MobileHeader } from '@/components/layout/mobile-header'
import { PwaInstallBanner } from '@/components/pwa/install-banner'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
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
        {/* Mobile top header */}
        <MobileHeader
          userName={session.user.name}
          userAvatar={session.user.image ?? undefined}
        />
        {/* Page content — bottom padding for mobile nav */}
        <div className="flex flex-1 flex-col overflow-hidden pb-16 md:pb-0">
          {children}
        </div>
      </main>

      {/* Bottom nav — visible on mobile only */}
      <MobileNav />

      {/* PWA install prompt — shown when browser fires beforeinstallprompt */}
      <PwaInstallBanner />
    </div>
  )
}
