import { describe, expect, it } from 'vitest'
import { featureLabel } from './ai-features'

describe('featureLabel', () => {
  it('uses the Spanish label for known features', () => {
    expect(featureLabel('chat.askFaro')).toBe('Chat: @faro')
    expect(featureLabel('documents')).toBe('Documentos con IA')
    expect(featureLabel('unknown')).toBe('Sin clasificar')
  })

  it('makes an unknown feature readable instead of hiding it', () => {
    expect(featureLabel('reports.buildExecutiveSummary')).toBe('Reports: build executive summary')
    expect(featureLabel('cron.daily-brief')).toBe('Cron: daily brief')
    expect(featureLabel('standalone')).toBe('Standalone')
  })
})
