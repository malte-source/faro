/**
 * Is something modal on screen? While a dialog, a bottom sheet or the command palette is open,
 * only that surface may react to keys — page shortcuts stay quiet. Client only (reads the DOM).
 */
export function isOverlayOpen(): boolean {
  if (typeof document === 'undefined') return false
  const body = document.body
  // BottomSheet sets data-sheet-open; the command palette sets data-palette-open.
  if (body.dataset.sheetOpen !== undefined || body.dataset.paletteOpen !== undefined) return true
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open], [aria-modal="true"]',
  )
}
