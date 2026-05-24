#!/usr/bin/env node
// Generates solid indigo PNG icons for PWA — no external dependencies
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

// CRC32 implementation (needed for valid PNG chunks)
function makeCRC32Table() {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
}
const CRC_TABLE = makeCRC32Table()
function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const typeB = Buffer.from(type, 'ascii')
  const lenB = Buffer.allocUnsafe(4); lenB.writeUInt32BE(data.length, 0)
  const crcB = Buffer.allocUnsafe(4); crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0)
  return Buffer.concat([lenB, typeB, data, crcB])
}

function createPNG(width, height, bgR, bgG, bgB) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth: 8
  ihdr[9] = 2  // color type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  // Raw scanlines: filter byte (0) + RGB pixels
  const bpr = 1 + width * 3
  const raw = Buffer.alloc(height * bpr)

  // Fill solid background color
  for (let y = 0; y < height; y++) {
    raw[y * bpr] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const i = y * bpr + 1 + x * 3
      raw[i] = bgR; raw[i + 1] = bgG; raw[i + 2] = bgB
    }
  }

  // Draw "F" letter in white (centered, pixel-art scale)
  const fPx = [
    [1,1,1,1,1,1,0],
    [1,0,0,0,0,0,0],
    [1,1,1,1,1,0,0],
    [1,0,0,0,0,0,0],
    [1,0,0,0,0,0,0],
    [1,0,0,0,0,0,0],
    [1,0,0,0,0,0,0],
  ]
  const scale = Math.floor(width / 12)
  const fW = fPx[0].length * scale
  const fH = fPx.length * scale
  const ox = Math.floor((width - fW) / 2)
  const oy = Math.floor((height - fH) / 2)

  for (let py = 0; py < fPx.length; py++) {
    for (let px = 0; px < fPx[py].length; px++) {
      if (fPx[py][px]) {
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = ox + px * scale + sx
            const y = oy + py * scale + sy
            if (x >= 0 && x < width && y >= 0 && y < height) {
              const i = y * bpr + 1 + x * 3
              raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255
            }
          }
        }
      }
    }
  }

  const idat = zlib.deflateSync(raw, { level: 6 })

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const outDir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(outDir, { recursive: true })

// Indigo #4f46e5 = rgb(79, 70, 229)
const [R, G, B] = [79, 70, 229]

fs.writeFileSync(path.join(outDir, 'icon-72.png'),   createPNG(72, 72, R, G, B))
fs.writeFileSync(path.join(outDir, 'icon-96.png'),   createPNG(96, 96, R, G, B))
fs.writeFileSync(path.join(outDir, 'icon-128.png'),  createPNG(128, 128, R, G, B))
fs.writeFileSync(path.join(outDir, 'icon-144.png'),  createPNG(144, 144, R, G, B))
fs.writeFileSync(path.join(outDir, 'icon-192.png'),  createPNG(192, 192, R, G, B))
fs.writeFileSync(path.join(outDir, 'icon-384.png'),  createPNG(384, 384, R, G, B))
fs.writeFileSync(path.join(outDir, 'icon-512.png'),  createPNG(512, 512, R, G, B))
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), createPNG(180, 180, R, G, B))

console.log('✓ PWA icons generated in public/icons/')
