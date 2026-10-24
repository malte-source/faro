import { baseMime, type UploadKind } from '@/lib/capture-schema'

/**
 * Media types for Captura — pure helpers shared by the recorder (browser), the
 * share-target route and the Gemini call (server).
 *
 * iPhone/Safari records AAC in an MP4 container (`audio/mp4`); Chrome/Firefox on
 * Android and desktop record Opus in WebM. The recorder asks for them in that
 * order of preference and stays consistent end to end: the blob's own type →
 * the upload's Content-Type → the extension in Storage → the type Gemini gets.
 */

/** Recorder candidates, best first. `audio/mp4` leads so iOS never falls into an unsupported container. */
export const AUDIO_RECORDER_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] as const

/** First candidate the browser can record; '' lets the browser choose its default. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string {
  for (const candidate of AUDIO_RECORDER_CANDIDATES) {
    try {
      if (isSupported(candidate)) return candidate
    } catch {
      /* some engines throw on unknown types: treat as unsupported */
    }
  }
  return ''
}

const EXT_TO_MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

/** MIME type from a file name — shared files sometimes arrive with an empty `type`. */
export function mimeFromFilename(name: string): string | null {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name.trim())
  return m ? (EXT_TO_MIME[m[1].toLowerCase()] ?? null) : null
}

/** 'audio' | 'video' | 'image' from a MIME type; null when Faro can't read it. */
export function uploadKindOfMime(mime: string): UploadKind | null {
  const t = baseMime(mime)
  if (t.startsWith('audio/')) return 'audio'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('image/')) return 'image'
  return null
}

/**
 * The MIME type to hand to Gemini as `inlineData.mimeType`. Browsers and OSes
 * use several spellings for the same container; Gemini documents one each.
 * `audio/webm` and `video/webm` pass through (they decode fine).
 */
const GEMINI_ALIASES: Record<string, string> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp4a-latm': 'audio/mp4',
  'audio/mpeg': 'audio/mp3',
  'audio/x-mp3': 'audio/mp3',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-aac': 'audio/aac',
  'audio/x-flac': 'audio/flac',
  'video/quicktime': 'video/mov',
  'video/x-m4v': 'video/mp4',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
}

export function geminiMimeType(kind: string, storedMime: string | null | undefined): string {
  const mime = baseMime(storedMime ?? '')
  if (!mime) {
    return kind === 'audio' ? 'audio/webm' : kind === 'video' ? 'video/mp4' : kind === 'image' ? 'image/jpeg' : 'application/octet-stream'
  }
  return GEMINI_ALIASES[mime] ?? mime
}
