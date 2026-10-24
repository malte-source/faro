/**
 * Capture outbox — captures (text, voice notes, photos, video) are written to
 * IndexedDB BEFORE any network call, so nothing a person records is lost to a
 * dead connection, a backgrounded PWA or a closed tab. A flusher (see
 * components/captura/use-outbox.ts) delivers them when it can.
 *
 * This file is storage + pure policy only (no React, no tRPC), so it can be
 * unit-tested. No dependency: a small wrapper over the raw IndexedDB API, with a
 * memory fallback because storage can be missing (private mode), blocked or
 * evicted — in which case items still survive for as long as the page lives.
 */

export type OutboxKind = 'text' | 'audio' | 'video' | 'image'

export interface OutboxItem {
  /** Idempotency key: the server returns the SAME capture for the same (user, clientId). */
  clientId: string
  kind: OutboxKind
  text?: string
  blob?: Blob
  mime?: string
  durationSec?: number
  createdAt: number
  attempts: number
  nextAttemptAt: number
  lastError: string | null
  /** Gave up automatically: waits for a manual retry or a discard. */
  failed: boolean
}

export const MAX_ATTEMPTS = 6
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000, 600_000]

/** Wait before attempt number `attempts + 1`, after `attempts` failures (1 → 5 s … 6 → 10 min). */
export function backoffMs(attempts: number): number {
  const i = Math.max(1, Math.floor(attempts)) - 1
  return BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]
}

/** Items that should be tried now: not given up, not in flight, backoff elapsed — oldest first. */
export function dueItems(items: OutboxItem[], now: number, inFlight: ReadonlySet<string> = new Set()): OutboxItem[] {
  return items
    .filter(i => !i.failed && !inFlight.has(i.clientId) && i.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** A failed upload with the HTTP status that came back from Storage. */
export class UploadHttpError extends Error {
  status: number
  constructor(status: number) {
    super('No se pudo subir el archivo. Intenta de nuevo.')
    this.name = 'UploadHttpError'
    this.status = status
  }
}

/**
 * Should a failed delivery be retried later ('retry') or reported now ('fatal')?
 * No HTTP status at all means the network failed (offline, dropped, aborted) →
 * retry. Timeouts, rate limits, 5xx and an expired session retry; a request the
 * server understood and refused (plan without AI, bad type, too big) does not.
 */
export function classifySendError(err: unknown): 'retry' | 'fatal' {
  const e = (err ?? {}) as {
    data?: { httpStatus?: number; code?: string } | null
    shape?: { data?: { httpStatus?: number; code?: string } } | null
    status?: number
    meta?: { response?: { status?: number } }
  }
  const status = e.data?.httpStatus ?? e.shape?.data?.httpStatus ?? e.status ?? e.meta?.response?.status
  if (typeof status !== 'number') return 'retry'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry'
  if (status === 401) return 'retry'
  if (status === 403) {
    const code = e.data?.code ?? e.shape?.data?.code
    return code === 'FORBIDDEN' ? 'fatal' : 'retry' // tRPC FORBIDDEN = plan/permission; a bare 403 = expired signed URL
  }
  return 'fatal'
}

export function errorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return (m || 'Sin conexión').slice(0, 140)
}

// ── Storage backends ────────────────────────────────────────────────────────

interface Backend {
  put(item: OutboxItem): Promise<void>
  get(id: string): Promise<OutboxItem | undefined>
  getAll(): Promise<OutboxItem[]>
  delete(id: string): Promise<void>
}

function memoryBackend(): Backend {
  const m = new Map<string, OutboxItem>()
  return {
    async put(item) { m.set(item.clientId, item) },
    async get(id) { return m.get(id) },
    async getAll() { return Array.from(m.values()) },
    async delete(id) { m.delete(id) },
  }
}

const DB_NAME = 'faro-outbox'
const STORE = 'items'

function idbBackend(db: IDBDatabase): Backend {
  const tx = <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      t.onabort = () => reject(t.error)
    })
  return {
    put: item => tx('readwrite', s => s.put(item)).then(() => undefined),
    get: id => tx<OutboxItem | undefined>('readonly', s => s.get(id)),
    getAll: () => tx<OutboxItem[]>('readonly', s => s.getAll()),
    delete: id => tx('readwrite', s => s.delete(id)).then(() => undefined),
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'clientId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('blocked'))
  })
}

let backendPromise: Promise<Backend> | null = null

function getBackend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = (async () => {
      try {
        if (typeof indexedDB === 'undefined') return memoryBackend()
        const db = await openIdb()
        // Probe once: Safari private mode opens the DB but fails on write.
        const b = idbBackend(db)
        const probe: OutboxItem = { clientId: '__probe__', kind: 'text', createdAt: 0, attempts: 0, nextAttemptAt: 0, lastError: null, failed: false }
        await b.put(probe)
        await b.delete(probe.clientId)
        return b
      } catch {
        return memoryBackend()
      }
    })()
  }
  return backendPromise
}

/** Tests only: force the in-memory backend and start empty. */
export function __resetOutboxForTests() {
  backendPromise = Promise.resolve(memoryBackend())
  inFlight.clear()
  listeners.clear()
}

// ── Change notifications (same tab + other tabs) ───────────────────────────

type Listener = () => void
const listeners = new Set<Listener>()
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  try {
    channel = new BroadcastChannel('faro-outbox')
    channel.onmessage = () => listeners.forEach(l => l())
    ;(channel as unknown as { unref?: () => void }).unref?.() // Node (tests): never keep the process alive
  } catch {
    channel = null
  }
  return channel
}

function emit() {
  listeners.forEach(l => l())
  try { getChannel()?.postMessage('changed') } catch { /* decoration */ }
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener)
  getChannel()
  return () => { listeners.delete(listener) }
}

// ── Items in flight (one delivery per item, across the hooks that may try) ──

const inFlight = new Set<string>()
export const markInFlight = (id: string) => { inFlight.add(id) }
export const unmarkInFlight = (id: string) => { inFlight.delete(id) }
export const inFlightIds = (): ReadonlySet<string> => inFlight

// ── Operations ──────────────────────────────────────────────────────────────

export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // RFC 4122 v4 fallback for older WebViews.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Best effort: ask the browser not to evict our queue under storage pressure. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) await navigator.storage.persist()
  } catch { /* optional */ }
}

export async function outboxAdd(
  input: { kind: OutboxKind; text?: string; blob?: Blob; mime?: string; durationSec?: number; clientId?: string },
): Promise<OutboxItem> {
  const now = Date.now()
  const item: OutboxItem = {
    clientId: input.clientId ?? newClientId(),
    kind: input.kind,
    text: input.text,
    blob: input.blob,
    mime: input.mime,
    durationSec: input.durationSec,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    failed: false,
  }
  try {
    await (await getBackend()).put(item)
  } catch {
    // Even a failing store must not block sending: the item still travels in memory.
  }
  void requestPersistentStorage()
  emit()
  return item
}

export async function outboxList(): Promise<OutboxItem[]> {
  try {
    return (await (await getBackend()).getAll()).sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function outboxGet(clientId: string): Promise<OutboxItem | undefined> {
  try { return await (await getBackend()).get(clientId) } catch { return undefined }
}

export async function outboxRemove(clientId: string): Promise<void> {
  try { await (await getBackend()).delete(clientId) } catch { /* nothing to clean */ }
  emit()
}

async function patch(clientId: string, change: Partial<OutboxItem>): Promise<void> {
  try {
    const b = await getBackend()
    const cur = await b.get(clientId)
    if (cur) await b.put({ ...cur, ...change })
  } catch { /* ignore */ }
  emit()
}

/**
 * Record a failed attempt. While offline it does NOT burn an attempt (the wait is
 * for the connection, not for the server); otherwise it backs off, and after
 * MAX_ATTEMPTS it gives up automatically and waits for a manual decision.
 */
export async function outboxMarkRetry(clientId: string, err: unknown, opts: { offline?: boolean } = {}): Promise<void> {
  const cur = await outboxGet(clientId)
  if (!cur) return
  const lastError = errorMessage(err)
  if (opts.offline) {
    await patch(clientId, { lastError, nextAttemptAt: Date.now() + 5_000 })
    return
  }
  const attempts = cur.attempts + 1
  await patch(clientId, {
    attempts,
    lastError,
    failed: attempts >= MAX_ATTEMPTS,
    nextAttemptAt: Date.now() + backoffMs(attempts),
  })
}

/** A refusal that retrying can't fix (plan, type, size): keep the item visible for a manual decision. */
export async function outboxMarkFatal(clientId: string, err: unknown): Promise<void> {
  await patch(clientId, { failed: true, lastError: errorMessage(err) })
}

/** When the flusher should wake up next: the earliest backoff among items still being retried. */
export function nextWakeAt(items: OutboxItem[]): number | null {
  const pending = items.filter(i => !i.failed)
  return pending.length ? Math.min(...pending.map(i => i.nextAttemptAt)) : null
}

/** Manual "Reintentar": back to a clean slate, due immediately. */
export async function outboxRetryNow(clientId: string): Promise<void> {
  await patch(clientId, { failed: false, attempts: 0, lastError: null, nextAttemptAt: Date.now() })
}
