'use client'

import { useSyncExternalStore } from 'react'
import { isStandalone } from './platform'

/**
 * Install state for the PWA, as a tiny external store so any component (the
 * coach, the "Más" card) sees the same thing and the `beforeinstallprompt`
 * event is captured as early as this module loads — Chrome fires it once, often
 * before a component has mounted.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const SNOOZE_KEY = 'faro:install:snoozeUntil'
export const SNOOZE_DAYS = 14
const DAY_MS = 86_400_000

interface InstallState {
  /** Chromium offered a native install prompt we can trigger. */
  canPrompt: boolean
  /** Installed (standalone now, or the appinstalled event fired). */
  installed: boolean
  /** The person said "Ahora no" less than SNOOZE_DAYS ago. */
  snoozed: boolean
}

const SERVER_STATE: InstallState = { canPrompt: false, installed: false, snoozed: true }

let deferred: BeforeInstallPromptEvent | null = null
let installedFlag = false
let state: InstallState = SERVER_STATE
const listeners = new Set<() => void>()

function readSnoozeUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0
  } catch {
    return 0 // storage blocked: just don't remember
  }
}

function compute(): InstallState {
  return {
    canPrompt: deferred !== null,
    installed: installedFlag || isStandalone(),
    snoozed: Date.now() < readSnoozeUntil(),
  }
}

function refresh() {
  const next = compute()
  if (next.canPrompt !== state.canPrompt || next.installed !== state.installed || next.snoozed !== state.snoozed) {
    state = next
    listeners.forEach(l => l())
  }
}

if (typeof window !== 'undefined') {
  state = compute()
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    refresh()
  })
  window.addEventListener('appinstalled', () => {
    installedFlag = true
    deferred = null
    refresh()
  })
}

function subscribe(l: () => void) {
  listeners.add(l)
  refresh()
  return () => { listeners.delete(l) }
}

/** Ask the browser to show its native install dialog. Resolves true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const ev = deferred
  try {
    await ev.prompt()
    const { outcome } = await ev.userChoice
    // A prompt event can be used once.
    deferred = null
    if (outcome === 'accepted') installedFlag = true
    refresh()
    return outcome === 'accepted'
  } catch {
    return false
  }
}

/** "Ahora no": stay quiet for SNOOZE_DAYS. */
export function snoozeInstall(days = SNOOZE_DAYS) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * DAY_MS))
  } catch { /* not remembered: it will ask again next visit */ }
  refresh()
}

export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE)
}
