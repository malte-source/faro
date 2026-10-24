import { describe, it, expect } from 'vitest'
import { isValidWebhookUrl } from './google-chat'

describe('isValidWebhookUrl', () => {
  it('accepts a canonical webhook URL', () => {
    const url = 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=foo&token=bar'
    expect(isValidWebhookUrl(url)).toBe(true)
  })

  it('rejects HTTP', () => {
    expect(isValidWebhookUrl('http://chat.googleapis.com/v1/spaces/A/messages?key=x')).toBe(false)
  })

  it('rejects other hosts', () => {
    expect(isValidWebhookUrl('https://hooks.slack.com/v1/spaces/A/messages?key=x')).toBe(false)
    expect(isValidWebhookUrl('https://example.com/webhook?key=x')).toBe(false)
  })

  it('rejects missing space ID', () => {
    expect(isValidWebhookUrl('https://chat.googleapis.com/v1/spaces//messages?key=x')).toBe(false)
  })

  it('rejects missing query params (the ? must be present)', () => {
    expect(isValidWebhookUrl('https://chat.googleapis.com/v1/spaces/A/messages')).toBe(false)
  })

  it('rejects empty / garbage', () => {
    expect(isValidWebhookUrl('')).toBe(false)
    expect(isValidWebhookUrl('not a url')).toBe(false)
  })
})
