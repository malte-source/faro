/** Tiny haptic tick where the platform supports it (Android/Chrome; iOS Safari ignores it silently). */
export function haptic(kind: 'tap' | 'success' | 'warning' = 'tap') {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(kind === 'tap' ? 8 : kind === 'success' ? [10, 40, 14] : [18, 60, 18])
  } catch {
    /* haptics are decoration, never an error */
  }
}
