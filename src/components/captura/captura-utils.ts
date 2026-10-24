import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers'
import { normalize, type ProposalWarning } from '@/lib/multiempresa'

type Outputs = inferRouterOutputs<AppRouter>
export type CaptureData = Outputs['capture']['get']
export type ProposalData = CaptureData['proposals'][number]
export type Directory = Outputs['membership']['directory']
export type DirectoryPersonData = Directory['people'][number]
export type EmpresaData = Directory['workspaces'][number]

export const KIND_TAG = { audio: 'AUD', video: 'VID', image: 'IMG', text: 'TXT' } as const
export const KIND_LABEL = { audio: 'Audio', video: 'Video', image: 'Imagen', text: 'Texto' } as const

export const READ_LABEL = {
  audio: 'Transcripción',
  video: 'Lo que se dice y se ve',
  image: 'Texto leído de la imagen',
  text: 'Mensajes',
} as const

/** Copy of the three steps shown while Faro reads, per kind (from the prototype). */
export const PROCESSING_STEPS = {
  audio: ['Transcribiendo el audio', 'Reconociendo personas, empresas y fechas', 'Armando las tareas'],
  video: ['Transcribiendo y mirando el video', 'Detectando pedidos y compromisos', 'Armando las tareas'],
  image: ['Leyendo el texto de la imagen', 'Cruzando nombres con el equipo', 'Armando las tareas'],
  text: ['Leyendo la conversación', 'Separando pedidos de comentarios', 'Armando las tareas'],
} as const

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?'
}

/** "2026-10-31" → "Vie 31 oct" */
export function formatDay(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const d = new Date(iso + 'T12:00:00Z')
  const wd = d.toLocaleDateString('es', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
  const mon = d.toLocaleDateString('es', { month: 'short', timeZone: 'UTC' }).replace('.', '')
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d.getUTCDate()} ${mon}`
}

const clean = (s: string) => normalize(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Index of the transcript line a proposal's quote comes from, or -1. Used for the hover ↔ highlight link. */
export function lineIndexFor(
  quote: string,
  quoteAt: string | null,
  lines: Array<{ at: string | null; text: string }>,
): number {
  const q = clean(quote)
  if (q) {
    const byText = lines.findIndex(l => {
      const t = clean(l.text)
      return t && (t.includes(q) || q.includes(t) || (q.length > 24 && t.includes(q.slice(0, 24))))
    })
    if (byText >= 0) return byText
  }
  if (quoteAt) {
    const byTime = lines.findIndex(l => l.at === quoteAt)
    if (byTime >= 0) return byTime
  }
  return -1
}

export interface WarningNote {
  text: string
  tone: 'signal' | 'danger'
}

/** Warning copy of README §3.4. */
export function warningNote(args: {
  code: ProposalWarning | null
  personName?: string
  empresaName?: string
  loadPct?: number
  /** First names of people with room that week, already filtered to the empresa. */
  alternatives?: string[]
}): WarningNote | null {
  const { code, personName = '', empresaName = 'esa empresa', loadPct = 0, alternatives = [] } = args
  if (code === 'sin_responsable') {
    return { text: 'Nadie se hizo cargo en la conversación. Elige quién se la lleva.', tone: 'signal' }
  }
  if (code === 'sin_membresia') {
    return { text: `${personName} no tiene cargo en ${empresaName}. Entraría como invitado.`, tone: 'signal' }
  }
  if (code === 'sobrecarga') {
    const alt = alternatives.length
      ? ` ${alternatives.slice(0, 2).join(' o ')} ${alternatives.length === 1 ? 'tiene' : 'tienen'} lugar.`
      : ''
    return { text: `${personName} ya está al ${loadPct}% esa semana.${alt}`, tone: 'danger' }
  }
  return null
}
