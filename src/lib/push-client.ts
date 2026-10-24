/**
 * Browser-side Web Push helpers. Everything here runs in the page (never on the server).
 *
 * Platform facts this is built around:
 *  - Android Chrome: push works in the browser tab and in the installed PWA.
 *  - iPhone/iPad (iOS 16.4+): push works ONLY for an app installed to the Home Screen; in a normal
 *    Safari tab `PushManager` doesn't even exist. We detect that case so the UI can explain the install.
 *  - iOS (and Chrome) require `Notification.requestPermission()` to be triggered by a user gesture,
 *    so it must be the FIRST async thing a tap handler does — before fetching keys or anything else.
 */

export type PushSupport = 'unsupported' | 'needs-install' | 'ready'

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac with touch.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function getPushSupport(): PushSupport {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (!('PushManager' in window)) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  return 'ready'
}

/** applicationServerKey wants bytes, the server gives base64url. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** The service worker may never become ready (it is off in dev) — don't hang the UI forever. */
async function readyRegistration(timeoutMs = 6000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (getPushSupport() !== 'ready') return null
  const reg = await readyRegistration(2500)
  return reg ? reg.pushManager.getSubscription() : null
}

export interface SerializedSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export function serialize(sub: PushSubscription): SerializedSubscription | null {
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
}

export type EnableResult =
  | { ok: true; subscription: SerializedSubscription }
  | { ok: false; reason: 'denied' | 'dismissed' | 'no-service-worker' | 'no-key' | 'failed' }

/**
 * Ask permission (must be called from a tap), subscribe and return what the server needs to store.
 * `loadKey` is only invoked AFTER permission is granted, to keep the user-gesture chain intact.
 */
export async function enablePush(loadKey: () => Promise<string | null>): Promise<EnableResult> {
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return { ok: false, reason: 'denied' }
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' }
  try {
    const reg = await readyRegistration()
    if (!reg) return { ok: false, reason: 'no-service-worker' }
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      const s = serialize(existing)
      if (s) return { ok: true, subscription: s }
    }
    const key = await loadKey()
    if (!key) return { ok: false, reason: 'no-key' }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
    const s = serialize(sub)
    return s ? { ok: true, subscription: s } : { ok: false, reason: 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/** Unsubscribe this device; returns the endpoint so the server can forget it. */
export async function disablePush(): Promise<string | null> {
  const sub = await currentSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  try { await sub.unsubscribe() } catch { /* the server copy is removed either way */ }
  return endpoint
}
