/**
 * Faro push handlers — merged into the generated service worker by @ducanh2912/next-pwa
 * (customWorkerSrc default "worker"; output public/worker-<hash>.js, gitignored).
 *
 * Classic Web Push: works on Android Chrome and on iOS 16.4+ for an installed PWA.
 * iOS requires every push to show a notification (no silent push), so we always show one.
 */

self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Faro', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Faro'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    // Same tag = the newer notification replaces the older one about the same thing.
    tag: data.tag || undefined,
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/dashboard/bandeja' },
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options)
      // App-icon badge with the unread count where the platform supports it.
      if (typeof data.unread === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
        try {
          if (data.unread > 0) await self.navigator.setAppBadge(data.unread)
          else await self.navigator.clearAppBadge()
        } catch {
          /* badges are decoration */
        }
      }
    })(),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/dashboard/bandeja', self.location.origin).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        // Move the already-open app to the notification's page without a full reload.
        if ('navigate' in client) {
          try { await client.navigate(target) } catch { /* cross-controller navigate can fail: the app is focused anyway */ }
        }
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
