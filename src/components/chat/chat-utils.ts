import { normalize } from '@/lib/multiempresa'

export { normalize }

export function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?'
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Calendar-day key in the viewer's timezone, used to place day separators. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Ayer'
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** "hace 5 min", "hace 2 h", "ayer", "12 oct". */
export function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `hace ${h} h`
  const days = Math.floor(h / 24)
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} d`
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

export const QUICK_EMOJIS = ['👍', '✅', '👀', '🙌', '❤️', '😂', '🔥', '❓'] as const

// ── Drafts: per channel/thread, in memory and (best effort) localStorage ──

const drafts = new Map<string, string>()
const STORAGE_PREFIX = 'faro:chat:draft:'

export function getDraft(key: string): string {
  const mem = drafts.get(key)
  if (mem !== undefined) return mem
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

export function setDraft(key: string, value: string): void {
  drafts.set(key, value)
  try {
    if (value) window.localStorage.setItem(STORAGE_PREFIX + key, value)
    else window.localStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    /* private mode / blocked storage: the in-memory draft is enough */
  }
}
