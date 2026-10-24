import { describe, expect, it } from 'vitest'
import { extForMime } from './capture-schema'
import { geminiMimeType, mimeFromFilename, pickRecorderMime, uploadKindOfMime } from './capture-media'

describe('pickRecorderMime', () => {
  it('prefers audio/mp4 on iOS-like engines', () => {
    expect(pickRecorderMime(m => m === 'audio/mp4')).toBe('audio/mp4')
    expect(pickRecorderMime(m => m === 'audio/mp4' || m === 'audio/webm')).toBe('audio/mp4')
  })
  it('falls back to opus-in-webm then plain webm (Chrome / Firefox)', () => {
    expect(pickRecorderMime(m => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(pickRecorderMime(m => m === 'audio/webm')).toBe('audio/webm')
  })
  it('returns empty (browser default) when nothing is supported or the probe throws', () => {
    expect(pickRecorderMime(() => false)).toBe('')
    expect(pickRecorderMime(() => { throw new Error('nope') })).toBe('')
  })
})

describe('geminiMimeType', () => {
  it('maps the spellings Gemini does not document', () => {
    expect(geminiMimeType('audio', 'audio/x-m4a')).toBe('audio/mp4')
    expect(geminiMimeType('audio', 'audio/mpeg')).toBe('audio/mp3')
    expect(geminiMimeType('audio', 'audio/x-wav')).toBe('audio/wav')
    expect(geminiMimeType('video', 'video/quicktime')).toBe('video/mov')
    expect(geminiMimeType('image', 'image/jpg')).toBe('image/jpeg')
  })
  it('passes through what already works, ignoring codec parameters', () => {
    expect(geminiMimeType('audio', 'audio/mp4')).toBe('audio/mp4')
    expect(geminiMimeType('audio', 'audio/webm;codecs=opus')).toBe('audio/webm')
    expect(geminiMimeType('audio', 'audio/aac')).toBe('audio/aac')
    expect(geminiMimeType('video', 'video/mp4')).toBe('video/mp4')
    expect(geminiMimeType('video', 'video/webm')).toBe('video/webm')
    expect(geminiMimeType('image', 'image/png')).toBe('image/png')
    expect(geminiMimeType('image', 'image/heic')).toBe('image/heic')
  })
  it('falls back per kind when the stored type is missing', () => {
    expect(geminiMimeType('audio', null)).toBe('audio/webm')
    expect(geminiMimeType('video', '')).toBe('video/mp4')
    expect(geminiMimeType('image', undefined)).toBe('image/jpeg')
    expect(geminiMimeType('text', null)).toBe('application/octet-stream')
  })
})

describe('mime ↔ extension stay consistent', () => {
  it('recorded types get the extension Storage expects', () => {
    expect(extForMime('audio/mp4')).toBe('m4a')
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extForMime('audio/m4a')).toBe('m4a')
  })
  it('round-trips file names to types and kinds', () => {
    expect(mimeFromFilename('Nota de voz 12.m4a')).toBe('audio/mp4')
    expect(mimeFromFilename('IMG_0001.HEIC')).toBe('image/heic')
    expect(mimeFromFilename('clip.MOV')).toBe('video/quicktime')
    expect(mimeFromFilename('notas.txt')).toBeNull()
    expect(uploadKindOfMime('audio/webm;codecs=opus')).toBe('audio')
    expect(uploadKindOfMime('video/mp4')).toBe('video')
    expect(uploadKindOfMime('image/jpeg')).toBe('image')
    expect(uploadKindOfMime('application/pdf')).toBeNull()
  })
})
