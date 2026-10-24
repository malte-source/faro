/**
 * FaroMark — the lighthouse symbol. Single source of truth for the logo.
 *
 * Two variants:
 *   default: 64×64 rounded square with Noche background, Señal light, halo,
 *            beam and Mist body. Use on light surfaces.
 *   plain:   no background square (transparent). Use on Noche surfaces (login,
 *            offline, tour tooltips).
 *
 * ≤32px consumers should import `FaroMarkSmall` instead — the beams and body
 * disappear at small sizes and only the light + single halo read.
 *
 * The wordmark is always "Faro" (F mayúscula, resto minúscula), rendered in
 * font-display + font-extrabold + tracking-[-0.04em]. Never "FARO" ni "faro".
 */

export function FaroMark({
  size = 32,
  plain = false,
  className,
}: {
  size?: number
  plain?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Faro"
      className={className}
    >
      {!plain && <rect width="64" height="64" rx="14" fill="#0A1A26" />}
      <circle cx="32" cy="20" r="5.5" fill="#FFB020" />
      <path d="M32 27 L52 47 H12 Z" fill="#FFB020" opacity="0.45" />
      <path d="M32 27 L43 47 H21 Z" fill="#FFB020" opacity="0.8" />
      <rect x="29" y="38" width="6" height="9" rx="1.5" fill="#F7F4EF" />
    </svg>
  )
}

/**
 * Simplified variant for favicons and any use ≤32px. Only the light + one
 * halo — the double beam and lamp body would turn to mud below 32px.
 */
export function FaroMarkSmall({
  size = 16,
  plain = false,
  className,
}: {
  size?: number
  plain?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Faro"
      className={className}
    >
      {!plain && <rect width="64" height="64" rx="14" fill="#0A1A26" />}
      <circle cx="32" cy="22" r="8" fill="#FFB020" />
      <path d="M32 30 L47 50 H17 Z" fill="#FFB020" opacity="0.8" />
    </svg>
  )
}
