'use client'

import { useEffect } from 'react'
import { ErrorScreen } from '@/components/common/error-screen'

/**
 * Error boundary for every route under the root layout (outside the dashboard,
 * which has its own). Shows no message or stack — only the opaque `digest`
 * Next.js attaches to server errors, which matches the server log line.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app error]', { digest: error.digest, name: error.name, message: error.message })
  }, [error])

  return (
    <ErrorScreen
      title="Algo no salió como esperábamos"
      description="No se perdió nada de lo que ya estaba guardado. Intenta de nuevo; si vuelve a pasar, envíanos el código de abajo."
      digest={error.digest}
      onRetry={reset}
      homeHref="/"
    />
  )
}
