/**
 * "Should this key press be left alone?" — the rule that keeps shortcuts from
 * eating what people type. Pure: works on the shape of an event, so it is tested
 * without a DOM.
 */

/** The bits of an event target the guard looks at (a real `HTMLElement` satisfies it). */
export interface TargetLike {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
}

export interface KeyEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  /** A DOM event passes its EventTarget; it is treated as a TargetLike. */
  target?: unknown
}

export interface GuardOptions {
  /** A dialog, sheet or the palette is open: only that surface may react to keys. */
  overlayOpen?: boolean
  /** Holding a key down repeats it. Only list navigation (j/k) wants that. */
  allowRepeat?: boolean
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const EDITABLE_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton', 'listbox'])

/** True when the target is somewhere the user is typing (or choosing from a native control). */
export function isEditableTarget(target?: TargetLike | null): boolean {
  if (!target) return false
  if (target.tagName && EDITABLE_TAGS.has(target.tagName.toUpperCase())) return true
  if (target.isContentEditable) return true
  const role = target.getAttribute?.('role')
  return !!role && EDITABLE_ROLES.has(role)
}

/** True when the target is a control that already owns Enter/Space (a focused link or button). */
export function isInteractiveTarget(target?: TargetLike | null): boolean {
  if (!target?.tagName) return false
  const tag = target.tagName.toUpperCase()
  if (tag === 'A' || tag === 'BUTTON' || tag === 'SUMMARY') return true
  const role = target.getAttribute?.('role')
  return role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab'
}

export function shouldIgnoreShortcut(ev: KeyEventLike, opts: GuardOptions = {}): boolean {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return true
  if (ev.isComposing || ev.key === 'Process') return true // IME composition
  if (ev.defaultPrevented) return true
  if (ev.repeat && !opts.allowRepeat) return true
  if (opts.overlayOpen) return true
  return isEditableTarget((ev.target ?? null) as TargetLike | null)
}
