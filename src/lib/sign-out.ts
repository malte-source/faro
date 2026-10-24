'use client'

import { signOut } from 'next-auth/react'

/**
 * localStorage prefixes that are harmless UI state, not user data. Everything else
 * under `faro` (chat drafts, saved task views…) is wiped on sign-out.
 */
const KEEP_PREFIXES = ['faro:onboarding:']

function wipeStorage(storage: Storage) {
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && key.toLowerCase().startsWith('faro') && !KEEP_PREFIXES.some(p => key.startsWith(p))) doomed.push(key)
  }
  doomed.forEach(k => storage.removeItem(k))
}

/**
 * Sign out AND leave nothing of the session behind on this device.
 *
 * FARO is a PWA: the service worker keeps Cache Storage entries (visited dashboard
 * pages, front-end navigation payloads) that outlive the session cookie. On a
 * shared phone or computer the next person could otherwise be served the previous
 * user's pages. Order matters: clear first, then end the session, so a failure to
 * clear can never leave the user signed in.
 */
export async function signOutAndClear(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch (err) {
    console.warn('[sign-out] could not clear Cache Storage', err)
  }

  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      wipeStorage(window[kind])
    } catch {
      /* storage can be blocked (private mode) — nothing to clear then */
    }
  }

  // Any React-Query / app IndexedDB the app may add later starts with "faro": drop those too.
  try {
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(
      dbs
        .filter(d => d.name && d.name.toLowerCase().startsWith('faro'))
        .map(d => new Promise<void>(resolve => {
          const req = indexedDB.deleteDatabase(d.name!)
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        })),
    )
  } catch {
    /* indexedDB.databases() is not available everywhere */
  }

  await signOut({ callbackUrl: '/login' })
}
