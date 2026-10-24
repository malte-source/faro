'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CAPTURE_MAX_SECONDS } from '@/lib/capture-schema'

export interface RecordingResult {
  blob: Blob
  /** Container MIME as recorded: webm/opus on Chrome & Firefox, mp4/aac on Safari/iOS. */
  mimeType: string
  durationSec: number
}

const BARS = 36
// Order matters: prefer opus-in-webm, fall back to AAC-in-mp4 (iOS/Safari).
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4']

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) ?? ''
}

/**
 * Microphone recorder with a live level meter (for the Señal waveform).
 * `stop()` resolves with the recording; `cancel()` throws it away. Recording
 * ends by itself at CAPTURE_MAX_SECONDS and reports through `onLimit`.
 */
export function useRecorder(opts: { onLimit?: (r: RecordingResult) => void } = {}) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08))
  const [error, setError] = useState<string | null>(null)

  const onLimitRef = useRef(opts.onLimit)
  useEffect(() => { onLimitRef.current = opts.onLimit }, [opts.onLimit])

  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const resolveRef = useRef<((r: RecordingResult | null) => void) | null>(null)
  const discardRef = useRef(false)

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (meterRef.current) clearInterval(meterRef.current)
    timerRef.current = meterRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setRecording(false)
    setLevels(Array(BARS).fill(0.08))
  }, [])

  useEffect(() => () => {
    discardRef.current = true
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
    teardown()
  }, [teardown])

  const finish = useCallback(() => {
    const rec = recRef.current
    if (!rec || rec.state === 'inactive') return
    rec.stop()
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no puede grabar audio.')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      discardRef.current = false
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
        const type = rec.mimeType || mime || 'audio/webm'
        const result: RecordingResult | null = discardRef.current || !chunksRef.current.length
          ? null
          : { blob: new Blob(chunksRef.current, { type }), mimeType: type, durationSec }
        teardown()
        const resolve = resolveRef.current
        resolveRef.current = null
        if (resolve) resolve(result)
        else if (result) onLimitRef.current?.(result)
      }
      recRef.current = rec

      // Level meter
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioCtx) {
        const ac = new AudioCtx()
        audioCtxRef.current = ac
        const analyser = ac.createAnalyser()
        analyser.fftSize = 64
        ac.createMediaStreamSource(stream).connect(analyser)
        const buf = new Uint8Array(analyser.frequencyBinCount)
        meterRef.current = setInterval(() => {
          analyser.getByteFrequencyData(buf)
          let sum = 0
          for (const v of buf) sum += v
          const level = Math.min(1, Math.max(0.08, (sum / buf.length / 255) * 2.2))
          setLevels(prev => [...prev.slice(1), level])
        }, 70)
      }

      startedAtRef.current = Date.now()
      setElapsed(0)
      rec.start(250)
      setRecording(true)
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setElapsed(s)
        if (s >= CAPTURE_MAX_SECONDS) finish() // resolveRef is null here → onLimit gets the result
      }, 250)
      return true
    } catch {
      teardown()
      setError('No pudimos usar el micrófono. Revisa el permiso del navegador.')
      return false
    }
  }, [finish, teardown])

  const stop = useCallback((): Promise<RecordingResult | null> => {
    const rec = recRef.current
    if (!rec || rec.state === 'inactive') return Promise.resolve(null)
    return new Promise(resolve => {
      resolveRef.current = resolve
      rec.stop()
    })
  }, [])

  const cancel = useCallback(() => {
    discardRef.current = true
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    else teardown()
  }, [teardown])

  return { recording, elapsed, levels, error, start, stop, cancel }
}

export function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
