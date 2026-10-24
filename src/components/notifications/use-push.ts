'use client'

import { useCallback, useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import { haptic } from '@/components/mobile/haptics'
import { currentSubscription, disablePush, enablePush, getPushSupport, type PushSupport } from '@/lib/push-client'

export type PushState =
  | 'loading'
  | 'server-off' // the server has no VAPID keys yet
  | 'unsupported'
  | 'needs-install'
  | 'denied'
  | 'off' // supported, permission not given (or not subscribed)
  | 'on'

/** State machine for "avisos en este dispositivo". Permission is only ever requested from `enable()`, which must run in a tap. */
export function usePush() {
  const utils = trpc.useUtils()
  const { data: status } = trpc.notifications.pushStatus.useQuery(undefined, { staleTime: 30_000 })
  const save = trpc.notifications.savePushSubscription.useMutation()
  const remove = trpc.notifications.removePushSubscription.useMutation()
  const test = trpc.notifications.sendTest.useMutation()

  const [support, setSupport] = useState<PushSupport | null>(null)
  const [permission, setPermission] = useState<NotificationPermission | 'none'>('none')
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    // Browser capabilities are only known on the client; read them after the first microtask (never during render/effect setup).
    await Promise.resolve()
    const s = getPushSupport()
    setSupport(s)
    setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'none')
    setSubscribed(s === 'ready' ? !!(await currentSubscription()) : false)
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      await Promise.resolve()
      const sup = getPushSupport()
      const sub = sup === 'ready' ? await currentSubscription() : null
      if (!alive) return
      setSupport(sup)
      setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'none')
      setSubscribed(!!sub)
    })()
    return () => { alive = false }
  }, [])

  const state: PushState =
    !status || support === null || subscribed === null ? 'loading'
    : !status.configured ? 'server-off'
    : support === 'needs-install' ? 'needs-install'
    : support === 'unsupported' ? 'unsupported'
    : permission === 'denied' ? 'denied'
    : permission === 'granted' && subscribed ? 'on'
    : 'off'

  /** MUST be called directly from a click/tap handler (iOS and Chrome require a user gesture for the permission prompt). */
  const enable = async () => {
    setBusy(true)
    try {
      const result = await enablePush(async () => {
        const res = await fetch('/api/push/public-key', { cache: 'no-store' })
        const body = (await res.json()) as { configured?: boolean; key?: string }
        return body.configured && body.key ? body.key : null
      })
      if (!result.ok) {
        if (result.reason === 'denied') toast.error('Avisos bloqueados', 'Cámbialo en la configuración del sitio o del teléfono.')
        else if (result.reason === 'dismissed') toast.info('No activaste los avisos', 'Puedes hacerlo cuando quieras.')
        else if (result.reason === 'no-service-worker') toast.error('Todavía no está listo', 'Recarga la app e inténtalo de nuevo.')
        else toast.error('No se pudieron activar los avisos', 'Inténtalo otra vez en unos segundos.')
        return
      }
      await save.mutateAsync({ ...result.subscription, userAgent: navigator.userAgent.slice(0, 300) })
      haptic('success')
      toast.success('Avisos activados en este dispositivo')
      void utils.notifications.pushStatus.invalidate()
    } catch (err) {
      toast.error('No se pudieron activar los avisos', err instanceof Error ? err.message : undefined)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      const endpoint = await disablePush()
      if (endpoint) await remove.mutateAsync({ endpoint })
      toast.info('Avisos desactivados en este dispositivo')
      void utils.notifications.pushStatus.invalidate()
    } catch (err) {
      toast.error('No se pudo desactivar', err instanceof Error ? err.message : undefined)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const sendTest = async () => {
    try {
      await test.mutateAsync()
      toast.success('Aviso de prueba enviado', 'Debería llegarte en unos segundos.')
    } catch (err) {
      toast.error('No se pudo enviar la prueba', err instanceof Error ? err.message : undefined)
    }
  }

  return { state, busy, devices: status?.devices ?? 0, enable, disable, sendTest, testing: test.isPending }
}
