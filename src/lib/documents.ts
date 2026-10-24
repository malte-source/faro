import type { DocumentKind, DocumentStatus } from '@/types/database'

/** Labels and small helpers shared by the Documentos router and UI (client-safe). */

export const DOC_KINDS: Array<{ value: DocumentKind; label: string; hint: string }> = [
  { value: 'politica', label: 'Política', hint: 'Reglas del grupo y quién las hace cumplir' },
  { value: 'manual', label: 'Manual', hint: 'Cómo funciona una función o el grupo completo' },
  { value: 'sop', label: 'Procedimiento (SOP)', hint: 'Pasos concretos para una tarea repetible' },
  { value: 'acta', label: 'Acta', hint: 'Lo decidido en un comité o reunión' },
  { value: 'raci', label: 'Matriz RACI', hint: 'Quién ejecuta, responde, consulta o es informado' },
  { value: 'jd', label: 'Descripción de cargo', hint: 'Responsabilidades, KPI y perfil de un rol' },
  { value: 'sla', label: 'SLA', hint: 'Acuerdo de servicio entre áreas o empresas' },
  { value: 'acuerdo', label: 'Acuerdo', hint: 'Borrador de acuerdo entre partes' },
  { value: 'otro', label: 'Otro', hint: 'Cualquier otro documento' },
]

export const DOC_KIND_LABEL: Record<DocumentKind, string> = Object.fromEntries(
  DOC_KINDS.map(k => [k.value, k.label]),
) as Record<DocumentKind, string>

export const DOC_STATUS_LABEL: Record<DocumentStatus, string> = {
  borrador: 'Borrador',
  en_revision: 'En revisión',
  aprobado: 'Aprobado',
  obsoleto: 'Obsoleto',
}

export const DOC_STATUS_BADGE: Record<DocumentStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  borrador: 'secondary',
  en_revision: 'warning',
  aprobado: 'success',
  obsoleto: 'outline',
}

/** Default review cycle once a document is approved. */
export const DEFAULT_REVIEW_DAYS = 180

export const ACUERDO_DISCLAIMER = 'Borrador de trabajo — no sustituye asesoría legal.'
