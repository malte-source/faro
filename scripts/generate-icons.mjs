// Regenerate every PWA icon from the Faro brand SVG.
//
// Sources:
//   public/icons/icon.svg        → full symbol (halo + light + double beam + body)
//   public/icons/icon-small.svg  → simplified (light + single halo) for ≤32px
//
// Outputs:
//   icon-{72..512}.png          → transparent-corner variants of the symbol
//   icon-maskable-{192,512}.png → symbol on Noche square, safe-zone 80%
//   apple-touch-icon.png        → symbol on Noche (iOS requires opaque)
//   favicon-{16,32}.png         → simplified variant
//
// Run: node scripts/generate-icons.mjs

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const svgMain = readFileSync(resolve(root, 'public/icons/icon.svg'))
const svgSmall = readFileSync(resolve(root, 'public/icons/icon-small.svg'))

const NOCHE = { r: 0x0a, g: 0x1a, b: 0x26, alpha: 1 }
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

const sizes = [72, 96, 128, 144, 180, 192, 384, 512]

console.log('Regenerating Faro icons from SVG…')

// ── Main "any" family: transparent-corner squircle with Noche interior ─────
// The SVG has Noche fill in the square already, so rasterising directly gives
// the interior tint we want, and the SVG's rx=15 rounds the corners.
for (const size of sizes) {
  await sharp(svgMain, { density: Math.max(72, size) })
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, `public/icons/icon-${size}.png`))
  console.log(`  ✓ icon-${size}.png`)
}

// ── apple-touch (180×180, opaque, iOS requires no alpha corners) ──────────
await sharp({ create: { width: 180, height: 180, channels: 4, background: NOCHE } })
  .composite([{ input: await sharp(svgMain, { density: 360 }).resize(180, 180).toBuffer() }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(root, 'public/icons/apple-touch-icon.png'))
console.log('  ✓ apple-touch-icon.png')

// ── Maskable variants — 80% safe zone on a full-bleed Noche square ────────
// Android's adaptive-icon spec crops arbitrary shapes off the outer ~10% per
// side. We render the symbol at 80% inside a Noche square so no mask ever
// clips the lamp body or the halo.
for (const size of [192, 512]) {
  const inner = Math.round(size * 0.8)
  const pad = Math.round((size - inner) / 2)
  const symbolNoBg = readFileSync(resolve(root, 'public/icons/icon.svg'))
    .toString()
    // Strip the outer Noche rect so the maskable safe-zone stays clean when
    // scaled down (otherwise you get a tiny rounded square inside a bigger
    // one). The background comes from the outer composite.
    .replace(/<rect\s+width="64"\s+height="64"[^/]*\/>/, '')
  const inner_buf = await sharp(Buffer.from(symbolNoBg), { density: Math.max(72, inner) })
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: NOCHE } })
    .composite([{ input: inner_buf, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, `public/icons/icon-maskable-${size}.png`))
  console.log(`  ✓ icon-maskable-${size}.png`)
}

// ── Favicons (16/32) — use the simplified SVG so light + halo still read ──
for (const size of [16, 32]) {
  await sharp(svgSmall, { density: Math.max(72, size * 4) })
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, `public/icons/favicon-${size}.png`))
  console.log(`  ✓ favicon-${size}.png`)
}

console.log('Done.')
