'use client'

import { InstallCoach } from './install-coach'

/**
 * Mounted by the dashboard layout. The old floating card (Android-only,
 * session-long dismissal) is replaced by InstallCoach: native prompt on Android
 * and desktop, Add-to-Home-Screen steps on iPhone/iPad, 14-day snooze.
 */
export function PwaInstallBanner() {
  return <InstallCoach />
}
