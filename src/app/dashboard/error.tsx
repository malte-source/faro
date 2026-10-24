'use client'

import { useEffect } from 'react'
import { ErrorScreen } from '@/components/common/error-screen'

/**
 * Error boundary for dashboard pages. It renders inside the dashboard layout, so
 * the sidebar / tab bar stay on screen and the person can simply navigate away.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard error]', { digest: error.digest, name: error.name, message: error.message })
  }, [error])

  return (
    <ErrorScreen
      inline
      title="Esta pantalla no pudo cargar"
      description="Tus datos están a salvo. Intenta de nuevo o vuelve al inicio; el resto de Faro sigue funcionando."
      digest={error.digest}
      onRetry={reset}
      homeHref="/dashboard"
    />
  )
}
