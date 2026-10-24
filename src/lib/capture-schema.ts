import { z } from 'zod'

/**
 * Captura — shared constants and the structured-output contract with Gemini.
 *
 * Optional values come back as "" (empty string) instead of null: it keeps the
 * JSON Schema trivially portable across model versions, and `clean()` below
 * maps "" → null before anything touches the database.
 */

export const CAPTURE_BUCKET = 'captures'

/**
 * Hard cap for a single media file. Gemini inline data travels base64-encoded
 * inside a ~20 MB request, and base64 inflates by 4/3, so ~14 MB of raw bytes
 * is the safe ceiling (the bucket itself allows 25 MB).
 */
export const CAPTURE_MAX_BYTES = 14 * 1024 * 1024
export const CAPTURE_BUCKET_LIMIT_BYTES = 25 * 1024 * 1024
/** Longest recording the app records / accepts (seconds). */
export const CAPTURE_MAX_SECONDS = 5 * 60
export const CAPTURE_TEXT_MAX_CHARS = 20_000

export const CAPTURE_FAILED_MESSAGE = 'No se pudo leer el archivo. Intenta de nuevo o pega el texto.'
export const CAPTURE_TOO_BIG_MESSAGE = 'El archivo pesa más de 14 MB. Envía un clip más corto o pega el texto.'

export type UploadKind = 'audio' | 'video' | 'image'

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

/** MIME without codec parameters ("audio/webm;codecs=opus" → "audio/webm"). */
export function baseMime(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase()
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[baseMime(mime)] ?? 'bin'
}

export function isMimeOfKind(kind: UploadKind, mime: string): boolean {
  return baseMime(mime).startsWith(`${kind}/`)
}

export const PRIORITIES = ['very_high', 'high', 'medium', 'low', 'very_low'] as const

/** JSON Schema handed to Gemini (responseJsonSchema). */
export const CAPTURE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    transcript: {
      type: 'array',
      description: 'Contenido segmentado en el orden original.',
      items: {
        type: 'object',
        properties: {
          at: { type: 'string', description: 'Tiempo "m:ss" en audio/video; "" si no aplica.' },
          speaker: { type: 'string', description: 'Quién habla; "" si no se distingue.' },
          text: { type: 'string' },
        },
        required: ['at', 'speaker', 'text'],
      },
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Imperativo corto, máximo 60 caracteres.' },
          assignee_id: { type: 'string', description: 'id de la lista de personas; "" si nadie fue nombrado ni se ofreció.' },
          workspace_id: { type: 'string', description: 'id de la lista de empresas; "" si no se puede deducir.' },
          project_id: { type: 'string', description: 'id de la lista de proyectos; "" si no aplica.' },
          due_date: { type: 'string', description: 'YYYY-MM-DD absoluta; "" si no se menciona.' },
          priority: { type: 'string', enum: [...PRIORITIES] },
          quote: { type: 'string', description: 'Frase LITERAL de donde sale la tarea.' },
          quote_at: { type: 'string', description: 'Tiempo "m:ss" de la frase; "" si no aplica.' },
          confidence: { type: 'number', description: 'Entre 0 y 1.' },
        },
        required: ['title', 'assignee_id', 'workspace_id', 'project_id', 'due_date', 'priority', 'quote', 'quote_at', 'confidence'],
      },
    },
  },
  required: ['transcript', 'tasks'],
} as const

const str = z.preprocess(v => (typeof v === 'string' ? v : v == null ? '' : String(v)), z.string())

export const modelOutputSchema = z.object({
  transcript: z.array(z.object({ at: str, speaker: str, text: str })).default([]),
  tasks: z
    .array(
      z.object({
        title: str,
        assignee_id: str,
        workspace_id: str,
        project_id: str,
        due_date: str,
        priority: str,
        quote: str,
        quote_at: str,
        confidence: z.preprocess(v => (typeof v === 'number' ? v : Number(v)), z.number()).catch(0.5),
      }),
    )
    .default([]),
})

export type ModelOutput = z.infer<typeof modelOutputSchema>

export interface TranscriptLine {
  at: string | null
  speaker: string | null
  text: string
}

/** "" → null. */
export const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim()
  return t ? t : null
}

export function isValidISODate(v: string | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(v + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
