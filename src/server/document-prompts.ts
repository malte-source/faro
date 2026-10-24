import type { DocumentKind } from '@/types/database'
import { DOC_KIND_LABEL, ACUERDO_DISCLAIMER } from '@/lib/documents'

/**
 * Prompt building blocks for the Documentos AI procedures. Everything is
 * neutral LatAm Spanish (tú). The model never invents names or figures: what
 * the context doesn't say becomes a [COMPLETAR: …] placeholder.
 */

export const DOC_SYSTEM_INSTRUCTION = `Eres Faro, asistente de gestión de un grupo de empresas. Redactas documentos internos en español neutro latinoamericano (tuteo, nunca voseo), claros, accionables y sin relleno.
Reglas:
- Responde SOLO con el documento en Markdown (títulos con ##, listas, tablas Markdown cuando corresponda). Sin explicaciones antes ni después, sin bloques de código que envuelvan todo el documento.
- No repitas el título del documento como encabezado de nivel 1: empieza directamente por la primera sección.
- No inventes nombres de personas, cifras, plazos, montos ni datos legales que no estén en el contexto. Donde falte un dato, escribe un marcador con este formato exacto: [COMPLETAR: qué falta].
- Usa los cargos y personas del contexto estructural solo si te lo piden y exactamente como aparecen.
- Frases cortas. Verbos en infinitivo o imperativo para reglas y pasos. Evita jerga innecesaria.`

const TEMPLATES: Record<DocumentKind, string> = {
  politica: `Estructura obligatoria (secciones ## en este orden):
## Propósito
## Alcance
## Principios
## Reglas
## Roles y responsabilidades (RACI)  — incluye una tabla Markdown con columnas Actividad | Responsable (R) | Aprobador (A) | Consultado (C) | Informado (I)
## Excepciones y escalamiento
## Métricas
## Revisión  — frecuencia de revisión y quién la dispara`,
  manual: `Estructura obligatoria (secciones ##):
## Introducción
## Capas y estructura
## Procesos
## Estándares
## Glosario`,
  sop: `Estructura obligatoria (secciones ##):
## Objetivo
## Cuándo se usa
## Pasos  — lista numerada, un verbo por paso
## Responsable
## Controles
## Errores comunes`,
  acta: `Estructura obligatoria (secciones ##):
## Fecha
## Asistentes
## Temas
## Decisiones
## Tareas  — tabla Markdown con columnas Tarea | Responsable | Fecha límite`,
  raci: `El documento es una tabla RACI en Markdown. Primero una breve sección ## Alcance (2-3 líneas), luego ## Matriz con una tabla: filas = actividades o decisiones, columnas = roles; en cada celda solo R, A, C, I o vacío (exactamente una A por fila). Cierra con ## Reglas de lectura (qué significa R, A, C, I).`,
  jd: `Estructura obligatoria (secciones ##):
## Resumen del cargo
## Responsabilidades
## A quién reporta  — línea sólida y, si aplica, línea punteada
## Decisiones que toma solo y decisiones que escala
## KPI
## Perfil buscado`,
  sla: `Estructura obligatoria (secciones ##):
## Servicio
## Alcance
## Tiempos de respuesta  — tabla Markdown con Tipo de solicitud | Tiempo de primera respuesta | Tiempo de resolución
## Métricas
## Penalidades  — consecuencias si no se cumple (usa [COMPLETAR] si no hay datos)
## Excepciones`,
  acuerdo: `Estructura sugerida (secciones ##): Partes, Objeto, Obligaciones de cada parte, Plazo y vigencia, Condiciones económicas, Confidencialidad, Terminación, Resolución de controversias, Firmas.
La PRIMERA línea del documento debe ser exactamente: > ${ACUERDO_DISCLAIMER}`,
  otro: `Organiza el documento con secciones ## lógicas para el tema indicado.`,
}

export function kindTemplate(kind: DocumentKind): string {
  return TEMPLATES[kind]
}

export function generatePrompt(opts: {
  kind: DocumentKind
  title: string
  brief: string
  today: string
  groupName: string
  scopeLine: string
  structure: string | null
}): string {
  return `Redacta un documento de tipo «${DOC_KIND_LABEL[opts.kind]}» titulado «${opts.title}» para el grupo «${opts.groupName}».
Ámbito: ${opts.scopeLine}. Fecha de hoy: ${opts.today}.

${kindTemplate(opts.kind)}

INDICACIONES DE QUIEN PIDE EL DOCUMENTO:
${opts.brief.trim() || '(sin indicaciones adicionales: redacta una base razonable y marca con [COMPLETAR: …] lo que dependa de datos del grupo)'}
${opts.structure ? `\nCONTEXTO ESTRUCTURAL REAL DEL GRUPO (úsalo; no agregues personas ni cargos que no estén aquí):\n${opts.structure}` : ''}`
}

export function improvePrompt(opts: { body: string; instruction: string }): string {
  return `Edita el siguiente documento siguiendo esta instrucción: «${opts.instruction.trim()}».
Conserva la estructura, el tono y los marcadores [COMPLETAR: …] salvo que la instrucción pida cambiarlos. No inventes datos nuevos. Devuelve el documento COMPLETO ya editado, solo Markdown.

DOCUMENTO:
${opts.body}`
}

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['alta', 'media', 'baja'] },
          text: { type: 'string' },
        },
        required: ['severity', 'text'],
      },
    },
  },
  required: ['findings'],
} as const

export function reviewPrompt(opts: { kind: DocumentKind; title: string; body: string; structure: string | null }): string {
  return `Revisa críticamente este documento interno de tipo «${DOC_KIND_LABEL[opts.kind]}» titulado «${opts.title}». Busca:
- vacíos (secciones que faltan para ese tipo de documento o que están vacías),
- ambigüedades (quién decide, plazos, umbrales sin número, términos sin definir),
- contradicciones internas,
- marcadores [COMPLETAR: …] sin resolver (resúmelos en un solo hallazgo),
${opts.structure ? '- incoherencias con la estructura real del grupo (cargos, líneas de reporte o capas que no existen o no coinciden),' : ''}
Devuelve entre 0 y 12 hallazgos, ordenados de mayor a menor severidad. Cada hallazgo: una o dos frases concretas, en español neutro, que digan qué está mal y cómo arreglarlo. Si el documento está sólido, devuelve pocos hallazgos; no inventes problemas.
${opts.structure ? `\nESTRUCTURA REAL DEL GRUPO:\n${opts.structure}\n` : ''}
DOCUMENTO:
${opts.body}`
}

/** Strip a ```markdown fence if the model wrapped the whole answer in one. */
export function stripMarkdownFence(text: string): string {
  const t = text.trim()
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(t)
  return (m ? m[1] : t).trim()
}
