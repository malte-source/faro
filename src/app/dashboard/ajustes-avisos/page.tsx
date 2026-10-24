import { Header } from '@/components/layout/header'
import { PushPermissionCard } from '@/components/notifications/push-permission'
import { NotificationPrefs } from '@/components/notifications/notification-prefs'
import { EmailPrefs } from '@/components/notifications/email-prefs'

export default function AjustesAvisosPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Avisos" description="Elige qué te avisamos y cuándo" />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-3 md:px-6 md:py-6">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <PushPermissionCard />
          <NotificationPrefs />
          <EmailPrefs />
        </div>
      </div>
    </div>
  )
}
