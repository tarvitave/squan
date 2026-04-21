/**
 * Generate Squan app icon — teal "S" with rounded background
 * Creates assets/icon.ico (multi-size) and assets/icon.png (256x256)
 */
import sharp from 'sharp'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

const SIZES = [16, 32, 48, 64, 128, 256]

// Squan brand teal: #13bbaf
// Dark background: #0e1117
function createSvg(size) {
  const pad = Math.round(size * 0.1)
  const r = Math.round(size * 0.22)
  const fontSize = Math.round(size * 0.62)
  const yOffset = Math.round(size * 0.05) // slight visual centering

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f9b93"/>
      <stop offset="100%" stop-color="#13bbaf"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="${Math.max(1, size * 0.02)}" stdDeviation="${Math.max(0.5, size * 0.015)}" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  <text x="${size / 2}" y="${size / 2 + yOffset}" 
        font-family="SF Pro Display, Segoe UI, Helvetica, Arial, sans-serif" 
        font-size="${fontSize}" font-weight="700" 
        fill="white" text-anchor="middle" dominant-baseline="central"
        filter="url(#shadow)">S</text>
</svg>`)
}

async function main() {
  console.log('Generating Squan icon...')

  // Generate PNGs at each size
  const pngBuffers = {}
  for (const size of SIZES) {
    const svg = createSvg(size)
    const png = await sharp(svg).resize(size, size).png().toBuffer()
    pngBuffers[size] = png
    console.log(`  ✓ ${size}x${size} (${png.length} bytes)`)
  }

  // Save 256x256 PNG
  writeFileSync(join('assets', 'icon.png'), pngBuffers[256])
  console.log('  → assets/icon.png')

  // Save 512x512 PNG for macOS
  const svg512 = createSvg(512)
  const png512 = await sharp(svg512).resize(512, 512).png().toBuffer()
  writeFileSync(join('assets', 'icon-512.png'), png512)
  console.log('  → assets/icon-512.png')

  // Build ICO file manually (Windows)
  // ICO format: header (6 bytes) + entries (16 bytes each) + image data
  const images = [16, 32, 48, 64, 128, 256].map(s => pngBuffers[s])
  const headerSize = 6 + images.length * 16
  let dataOffset = headerSize

  // Calculate total size
  let totalSize = headerSize
  for (const img of images) totalSize += img.length

  const ico = Buffer.alloc(totalSize)

  // ICO header
  ico.writeUInt16LE(0, 0)              // reserved
  ico.writeUInt16LE(1, 2)              // type: ICO
  ico.writeUInt16LE(images.length, 4)  // count

  // Directory entries
  for (let i = 0; i < images.length; i++) {
    const size = SIZES[i]
    const entryOffset = 6 + i * 16

    ico[entryOffset] = size < 256 ? size : 0     // width (0 = 256)
    ico[entryOffset + 1] = size < 256 ? size : 0 // height
    ico[entryOffset + 2] = 0                       // color palette
    ico[entryOffset + 3] = 0                       // reserved
    ico.writeUInt16LE(1, entryOffset + 4)          // color planes
    ico.writeUInt16LE(32, entryOffset + 6)         // bits per pixel
    ico.writeUInt32LE(images[i].length, entryOffset + 8)  // image size
    ico.writeUInt32LE(dataOffset, entryOffset + 12)       // data offset

    images[i].copy(ico, dataOffset)
    dataOffset += images[i].length
  }

  writeFileSync(join('assets', 'icon.ico'), ico)
  console.log(`  → assets/icon.ico (${ico.length} bytes, ${images.length} sizes)`)

  // Also create tray-specific icons
  const tray16 = pngBuffers[16]
  const tray32 = pngBuffers[32]
  writeFileSync(join('assets', 'tray-icon.png'), tray16)
  writeFileSync(join('assets', 'tray-icon@2x.png'), tray32)
  console.log('  → assets/tray-icon.png + tray-icon@2x.png')

  console.log('\nDone! Icon generated with sizes:', SIZES.join(', '))
}

main().catch(console.error)
