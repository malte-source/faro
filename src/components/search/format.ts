/** "hoy", "ayer", "hace 3 d" or "12 oct" — a short, calm date for result rows. Pure (takes `now`) so it is testable. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} d`
  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString('es', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).replace('.', '')
}

const RECENT_KEY = 'faro:recent-searches'
const RECENT_MAX = 5

/** Recent queries live in the browser only (try/catch: storage can be blocked). */
export function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function pushRecent(query: string): void {
  const q = query.trim()
  if (q.length < 2) return
  try {
    const next = [q, ...readRecent().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* recent searches are a convenience, never an error */
  }
}

export function clearRecent(): void {
  try {
    window.localStorage.removeItem(RECENT_KEY)
  } catch {
    /* ignore */
  }
}
