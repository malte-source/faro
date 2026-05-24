import { GoogleGenerativeAI } from '@google/generative-ai'

let _client: GoogleGenerativeAI | null = null

export function getGeminiClient() {
  if (!_client) {
    const key = process.env.GOOGLE_GEMINI_API_KEY
    if (!key) throw new Error('GOOGLE_GEMINI_API_KEY not set')
    _client = new GoogleGenerativeAI(key)
  }
  return _client
}

export function getFlashModel() {
  return getGeminiClient().getGenerativeModel({ model: 'gemini-1.5-flash' })
}
