/** DOM-side actions shared by the shortcut provider and the command palette. Client only. */

/**
 * "Nueva tarea": in grupo mode the one-line bar is always on screen, so focus it; otherwise
 * ask the sidebar (which owns the quick-create modal) to open it by replaying its own `n` key.
 */
export function createTask() {
  const bar = document.querySelector<HTMLInputElement>('input[aria-label="Crear tarea en una línea"]')
  if (bar && bar.offsetParent !== null) {
    bar.focus()
    bar.select()
    return
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
}

/** "Nueva tarea con IA": the sidebar opens the magic quick-add on Shift+N. */
export function createTaskWithAI() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'N', shiftKey: true, bubbles: true }))
}
