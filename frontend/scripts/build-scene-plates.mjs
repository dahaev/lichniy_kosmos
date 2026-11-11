// Exports scene plates from assets-src/ into src/scene/plates/ (ARCHITECTURE_MVP_v2 §17.2c):
// pads the master so the planet can be placed at reference size without gaps,
// applies the grade from plates.config.json, encodes AVIF and WebP per width
// and writes plates.json with the geometry the scene layout needs.
//
// Requires macOS `sips` (JPEG decode, resize) and the `cwebp` / `avifenc` CLIs.
// Masters are never modified.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PNG } from 'pngjs'

const root = path.resolve(import.meta.dirname, '..')
const srcDir = path.resolve(root, '..', 'assets-src', 'hero')
const outDir = path.join(root, 'src', 'scene', 'plates')
const cacheDir = path.join(root, 'node_modules', '.cache', 'scene-plates')

/** Rows of the bottom edge averaged into the structureless bottom padding. */
const BOTTOM_SAMPLE_ROWS = 16
const BOTTOM_BLUR_RADIUS = 48

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
}

function decode(file) {
  const png = path.join(cacheDir, `${path.basename(file)}.png`)
  run('sips', ['-s', 'format', 'png', file, '--out', png])
  return PNG.sync.read(readFileSync(png))
}

function sourceX(x, width) {
  if (x < 0) return Math.min(-x - 1, width - 1)
  // The right edge sits next to the planet rim; mirroring would duplicate it.
  return Math.min(x, width - 1)
}

/**
 * Mean of the last rows, box-blurred horizontally: continuing the water by
 * reflection would repeat rocks and highlights of the bottom edge.
 */
function bottomTone(src) {
  const mean = new Float32Array(src.width * 3)
  for (let y = src.height - BOTTOM_SAMPLE_ROWS; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      for (let c = 0; c < 3; c++) mean[x * 3 + c] += src.data[(y * src.width + x) * 4 + c] / BOTTOM_SAMPLE_ROWS
    }
  }
  const blurred = new Float32Array(mean.length)
  for (let x = 0; x < src.width; x++) {
    const from = Math.max(0, x - BOTTOM_BLUR_RADIUS)
    const to = Math.min(src.width - 1, x + BOTTOM_BLUR_RADIUS)
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let k = from; k <= to; k++) sum += mean[k * 3 + c]
      blurred[x * 3 + c] = sum / (to - from + 1)
    }
  }
  return blurred
}

function pad(src, { left, right, top, bottom }) {
  const out = new PNG({ width: src.width + left + right, height: src.height + top + bottom })
  const tone = bottomTone(src)
  for (let y = 0; y < out.height; y++) {
    const sy = y - top
    for (let x = 0; x < out.width; x++) {
      const sx = sourceX(x - left, src.width)
      const di = (y * out.width + x) * 4
      if (sy < src.height) {
        const si = (Math.max(sy, 0) * src.width + sx) * 4
        out.data[di] = src.data[si]
        out.data[di + 1] = src.data[si + 1]
        out.data[di + 2] = src.data[si + 2]
      } else {
        // Blend from the real last row into the tone, then darken slightly.
        const t = Math.min(1, (sy - src.height + 1) / 24)
        const fade = Math.max(0.6, 1 - (sy - src.height) / (bottom * 1.6))
        const si = ((src.height - 1) * src.width + sx) * 4
        for (let c = 0; c < 3; c++) out.data[di + c] = (src.data[si + c] * (1 - t) + tone[sx * 3 + c] * t) * fade
      }
      out.data[di + 3] = 255
    }
  }
  return out
}

function grade(png, { lift, warm }, offset) {
  const cx = warm.x + offset.x
  const cy = warm.y + offset.y
  const tint = [255, 168, 92]
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      const d = Math.hypot(x - cx, y - cy) / warm.radius
      const w = warm.strength * Math.exp(-d * d)
      for (let c = 0; c < 3; c++) {
        const v = (png.data[i + c] / 255) * lift
        // Screen blend keeps blacks black and lifts warm midtones.
        png.data[i + c] = Math.round(Math.min(1, 1 - (1 - v) * (1 - (tint[c] / 255) * w)) * 255)
      }
    }
  }
}

function encode(id, png, widths) {
  const master = path.join(cacheDir, `${id}.png`)
  writeFileSync(master, PNG.sync.write(png))
  const files = {}
  for (const width of widths) {
    const sized = path.join(cacheDir, `${id}-${width}.png`)
    if (width === png.width) writeFileSync(sized, readFileSync(master))
    else run('sips', ['--resampleWidth', String(width), master, '--out', sized])
    const webp = `${id}-${width}.webp`
    const avif = `${id}-${width}.avif`
    run('cwebp', ['-quiet', '-q', '82', '-m', '6', '-sharp_yuv', sized, '-o', path.join(outDir, webp)])
    run('avifenc', ['-q', '60', '-s', '4', '-y', '420', sized, path.join(outDir, avif)])
    files[width] = { webp, avif }
  }
  return files
}

const config = JSON.parse(readFileSync(path.join(srcDir, 'plates.config.json'), 'utf8'))
rmSync(cacheDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

const meta = []
for (const plate of config.plates) {
  const src = decode(path.join(srcDir, plate.master))
  const padded = pad(src, plate.pad)
  const offset = { x: plate.pad.left, y: plate.pad.top }
  grade(padded, plate.grade, offset)
  const files = encode(plate.id, padded, plate.widths.filter((w) => w <= padded.width))
  meta.push({
    id: plate.id,
    temporary: plate.temporary,
    width: padded.width,
    height: padded.height,
    planet: { x: plate.planet.x + offset.x, y: plate.planet.y + offset.y, r: plate.planet.r },
    horizonY: plate.horizonY + offset.y,
    ...(plate.groundTop === undefined ? {} : { groundTop: plate.groundTop + offset.y }),
    files,
  })
  console.log(`${plate.id}: ${padded.width}x${padded.height}`, Object.values(files).map((f) => f.webp).join(', '))
}

writeFileSync(path.join(outDir, 'plates.json'), `${JSON.stringify({ generatedBy: 'scripts/build-scene-plates.mjs', plates: meta }, null, 2)}\n`)
