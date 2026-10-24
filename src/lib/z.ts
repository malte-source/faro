/**
 * Centralized z-index strategy.
 *
 * Before this file existed, every component picked its own `z-[N]` value
 * ad-hoc. Result: onboarding tour at z-70, command palette at z-60, modals
 * at z-50, confirm dialogs at z-90, toast at z-100 — with no clear order
 * and frequent overlapping bugs (modal inside modal, tour eating click
 * targets, etc).
 *
 * The new model is a single stacking ladder. The numbers are spaced by 10
 * so we have room to insert intermediate layers without renumbering.
 *
 *   Z.BASE          = 0      → normal flow content
 *   Z.STICKY        = 10     → headers, sticky table headers
 *   Z.DROPDOWN      = 20     → inline dropdowns (selects, popovers anchored)
 *   Z.SIDEBAR       = 30     → desktop sidebar, mobile bottom nav
 *   Z.PANEL         = 40     → side drawers / task detail panel
 *   Z.MODAL         = 50     → primary modal layer (most dialogs)
 *   Z.COMMAND       = 60     → command palette (above modals so ⌘K works always)
 *   Z.CONFIRM       = 70     → confirm/alert dialog (above command palette)
 *   Z.TOOLTIP       = 80     → tooltips that can appear over everything
 *   Z.TOAST         = 90     → top-most non-blocking surfaces
 *   Z.ONBOARDING    = 100    → onboarding tour — last because it's exclusive
 *
 * Note: these are exported as STRING tailwind class names because Tailwind
 * is statically analyzed (it needs to see the literal class) — we can't use
 * `style={{ zIndex: 50 }}` everywhere without losing color/border classes.
 *
 * Usage:
 *   import { Z } from '@/lib/z'
 *   <div className={`fixed inset-0 ${Z.MODAL}`}>...</div>
 */

export const Z = {
  /** Normal flow — explicit 0 for cases that need to opt-out of stacking. */
  BASE: 'z-0',
  /** Sticky headers, table column headers. */
  STICKY: 'z-10',
  /** Inline dropdowns / popovers anchored to a button. */
  DROPDOWN: 'z-20',
  /** Sidebar (desktop) + mobile bottom nav. */
  SIDEBAR: 'z-30',
  /** Side drawers — task detail panel, settings drawer. */
  PANEL: 'z-40',
  /** Primary modal layer. Most dialogs live here. */
  MODAL: 'z-50',
  /** Command palette (⌘K) — must sit ABOVE modals so it always opens. */
  COMMAND: 'z-[60]',
  /** Confirm/alert dialog — invoked from inside other modals. */
  CONFIRM: 'z-[70]',
  /** Tooltips. */
  TOOLTIP: 'z-[80]',
  /** Toast notifications — should appear over confirm dialogs too. */
  TOAST: 'z-[90]',
  /** Onboarding tour overlay. Exclusive: shown alone, no other layer needed above. */
  ONBOARDING: 'z-[100]',
} as const

/** Tailwind class for the standard modal backdrop. Use everywhere for consistency. */
export const MODAL_BACKDROP = 'bg-black/50 backdrop-blur-[2px]'
