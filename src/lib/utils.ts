import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

export function daysUntil(date: string | Date) {
  const diff = new Date(date).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export const PROJECT_STATUS = {
  not_started: { label: 'No iniciado', color: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'En progreso', color: 'bg-blue-100 text-blue-700' },
  on_hold: { label: 'En pausa', color: 'bg-yellow-100 text-yellow-700' },
  delayed: { label: 'Retrasado', color: 'bg-orange-100 text-orange-700' },
  completed: { label: 'Completado', color: 'bg-green-100 text-green-700' },
  canceled: { label: 'Cancelado', color: 'bg-red-100 text-red-600' },
  pending: { label: 'Pendiente', color: 'bg-purple-100 text-purple-700' },
} as const

export const PRIORITY = {
  very_high: { label: 'Muy alta', color: 'text-red-600', dot: 'bg-red-500' },
  high: { label: 'Alta', color: 'text-orange-600', dot: 'bg-orange-500' },
  medium: { label: 'Media', color: 'text-yellow-600', dot: 'bg-yellow-500' },
  low: { label: 'Baja', color: 'text-green-600', dot: 'bg-green-500' },
  very_low: { label: 'Muy baja', color: 'text-slate-500', dot: 'bg-slate-400' },
} as const

export const KANBAN_STAGES = [
  { id: 'ideas', label: '💡 Ideas' },
  { id: 'backlog', label: '📋 Backlog' },
  { id: 'pending', label: '⏳ Pendiente' },
  { id: 'in_progress', label: '🚀 En progreso' },
  { id: 'on_hold', label: '⏸️ En pausa' },
  { id: 'completed', label: '✅ Completado' },
  { id: 'canceled', label: '❌ Cancelado' },
] as const
