import type { SequenceDef } from './matcher'

/**
 * The single list of keyboard shortcuts: the provider matches against it, the help
 * sheet prints it and the command palette reads its hints from it — so a key can
 * never be documented in one place and bound in another.
 */

export type ShortcutGroup = 'Navegación' | 'Crear' | 'Listas' | 'Tareas' | 'General'

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['Navegación', 'Crear', 'Listas', 'Tareas', 'General']

export type ShortcutAction = 'navigate' | 'create' | 'search' | 'help'

export interface ShortcutInfo {
  id: string
  group: ShortcutGroup
  label: string
  /** Normalised key sequence matched by the global provider ([] when the shortcut is handled elsewhere). */
  keys: string[]
  /** Chord handled elsewhere (⌘K, ⌘Z, ⇧N): shown in help, never matched here. */
  chord?: string
  /** Handled by the list or task surface that is on screen, not by the global provider. */
  contextual?: boolean
  action?: ShortcutAction
  href?: string
}

export interface CatalogOptions {
  /** Grupo mode (La Trinchera style): Hoy is home and Personas replaces Equipo. */
  groupMode: boolean
}

export function buildCatalog({ groupMode }: CatalogOptions): ShortcutInfo[] {
  return [
    // ── Navegación ──
    { id: 'nav-home', group: 'Navegación', keys: ['g', 'h'], action: 'navigate', label: groupMode ? 'Ir a Hoy' : 'Ir a Inicio', href: groupMode ? '/dashboard/hoy' : '/dashboard' },
    { id: 'nav-projects', group: 'Navegación', keys: ['g', 'p'], action: 'navigate', label: 'Ir a Proyectos', href: '/dashboard/projects' },
    { id: 'nav-tasks', group: 'Navegación', keys: ['g', 't'], action: 'navigate', label: 'Ir a Tareas', href: '/dashboard/tasks' },
    { id: 'nav-chat', group: 'Navegación', keys: ['g', 'c'], action: 'navigate', label: 'Ir al Chat', href: '/dashboard/chat' },
    { id: 'nav-docs', group: 'Navegación', keys: ['g', 'd'], action: 'navigate', label: 'Ir a Documentos', href: '/dashboard/documentos' },
    { id: 'nav-people', group: 'Navegación', keys: ['g', 'm'], action: 'navigate', label: groupMode ? 'Ir a Personas' : 'Ir a Equipo', href: groupMode ? '/dashboard/personas' : '/dashboard/team' },
    { id: 'nav-kanban', group: 'Navegación', keys: ['g', 'k'], action: 'navigate', label: 'Ir al Kanban', href: '/dashboard/kanban' },
    { id: 'nav-settings', group: 'Navegación', keys: ['g', 's'], action: 'navigate', label: 'Ir a Configuración', href: '/dashboard/settings' },

    // ── Crear y buscar ──
    { id: 'create', group: 'Crear', keys: ['c'], action: 'create', label: 'Nueva tarea' },
    { id: 'create-form', group: 'Crear', keys: [], chord: 'N', contextual: true, label: 'Nueva tarea (formulario completo)' },
    { id: 'create-ai', group: 'Crear', keys: [], chord: '⇧ N', contextual: true, label: 'Nueva tarea con IA' },
    { id: 'search', group: 'Crear', keys: ['/'], action: 'search', label: 'Buscar' },
    { id: 'palette', group: 'Crear', keys: [], chord: '⌘ K', contextual: true, label: 'Buscar o ejecutar un comando' },

    // ── Listas (la lista que está en pantalla) ──
    { id: 'list-down', group: 'Listas', keys: [], chord: 'J', contextual: true, label: 'Bajar una fila' },
    { id: 'list-up', group: 'Listas', keys: [], chord: 'K', contextual: true, label: 'Subir una fila' },
    { id: 'list-open', group: 'Listas', keys: [], chord: '↵', contextual: true, label: 'Abrir la fila' },
    { id: 'list-clear', group: 'Listas', keys: [], chord: 'Esc', contextual: true, label: 'Quitar el foco de la fila' },

    // ── Tareas (sobre la fila con foco) ──
    { id: 'task-done', group: 'Tareas', keys: [], chord: 'X', contextual: true, label: 'Marcar hecha o reabrir' },
    { id: 'task-edit', group: 'Tareas', keys: [], chord: 'E', contextual: true, label: 'Abrir para editar' },
    { id: 'task-undo', group: 'Tareas', keys: [], chord: '⌘ Z', contextual: true, label: 'Deshacer la última acción' },

    // ── General ──
    { id: 'help', group: 'General', keys: ['?'], action: 'help', label: 'Ver todos los atajos' },
  ]
}

/** Definitions the global sequence matcher listens for. */
export function matcherDefs(catalog: ShortcutInfo[]): SequenceDef[] {
  return catalog.filter(s => !s.contextual && s.keys.length > 0).map(s => ({ id: s.id, keys: s.keys }))
}

const KEY_LABEL: Record<string, string> = { Enter: '↵', Escape: 'Esc', ArrowDown: '↓', ArrowUp: '↑' }

export function displayKey(key: string): string {
  return KEY_LABEL[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** "G H" for a sequence, the chord text for a chord, '' when there is no shortcut. */
export function formatShortcut(s?: Pick<ShortcutInfo, 'keys' | 'chord'>): string {
  if (!s) return ''
  if (s.keys.length) return s.keys.map(displayKey).join(' ')
  return s.chord ?? ''
}

/** Shortcut hint for a catalog id (used by the palette). */
export function hintFor(catalog: ShortcutInfo[], id: string): string | undefined {
  const text = formatShortcut(catalog.find(s => s.id === id))
  return text || undefined
}
