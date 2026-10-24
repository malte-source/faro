/**
 * Human labels for the `feature` recorded with each AI call (a tRPC path such as
 * `tasks.parseAndCreate`, an explicit label such as `documents`, or a cron task).
 * Unknown features fall back to a readable version of their own name, so a new AI
 * feature shows up in the meter before anyone remembers to label it.
 */
const LABELS: Record<string, string> = {
  'tasks.parseAndCreate': 'Tarea con IA (texto)',
  'tasks.parseAudioAndCreate': 'Tarea con IA (audio)',
  'tasks.parseImageAndCreate': 'Tarea con IA (imagen)',
  'tasks.parseMeetingNotes': 'Reunión → tareas',
  'tasks.nextSuggestion': '¿Qué hago ahora?',
  'projects.aiInsight': 'Análisis del proyecto',
  'aiChat.send': 'Chat con IA del proyecto',
  'aiSummarize.summarizeTaskComments': 'Resumen de comentarios',
  'aiSummarize.summarizeProjectWeek': 'Resumen semanal del proyecto',
  'projectUpdates.generateDraft': 'Borrador de actualización',
  'digests.weekly': 'Resumen semanal',
  'chat.summarize': 'Chat: ¿qué me perdí?',
  'chat.askFaro': 'Chat: @faro',
  'capture.submit': 'Captura (audio, foto o video)',
  'capture.submitText': 'Captura (texto)',
  'documents': 'Documentos con IA',
  'documents.generate': 'Documentos: generar',
  'documents.improve': 'Documentos: mejorar',
  'documents.review': 'Documentos: revisar',
  'costos.explain': 'Costos: explicación',
  'team.generateJobDescription': 'Descripción de cargo',
  'cron.weekly-digest': 'Resumen semanal (automático)',
  unknown: 'Sin clasificar',
}

export function featureLabel(feature: string): string {
  const known = LABELS[feature]
  if (known) return known
  // `area.someAction` → "Area: some action"
  const [area, ...rest] = feature.split('.')
  const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase()
  const head = words(area).replace(/^./, c => c.toUpperCase())
  return rest.length ? `${head}: ${words(rest.join(' '))}` : head
}
