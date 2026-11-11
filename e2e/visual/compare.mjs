// Visual stand (ARCHITECTURE_MVP_v2 §25 stage 3) without the impeccable engine:
// for every snapshot builds side-by-side, 50% overlay and pixel diff images
// against the derived reference. Reports numbers; it does not gate in S0.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import { MASK, blank, crop, fillRect, paste, readPng, resize, writePng } from './png.mjs'

const OUT = 'visual/output'
const reference = readPng('visual/reference/hero-desktop.png')
const meta = JSON.parse(readFileSync('visual/reference/hero-desktop.json', 'utf8'))

// The reference is a desktop frame; narrow viewports get no pixel comparison
// until per-viewport references are approved (see S0 report).
const compared = ['desktop-1440', 'wide-1920']
const summary = []

for (const name of compared) {
  const file = `${OUT}/snapshots/${name}.png`
  if (!existsSync(file)) {
    console.error(`missing snapshot ${file}; run "npm run visual" first`)
    process.exit(1)
  }
  const shot = readPng(file)
  const scale = shot.width / reference.width
  const refScaled = resize(reference, shot.width, Math.round(reference.height * scale))
  const height = Math.min(shot.height, refScaled.height)
  const area = { x: 0, y: 0, width: shot.width, height }
  const a = crop(refScaled, area)
  const b = crop(shot, area)

  for (const r of meta.ignore) {
    const rect = {
      x: Math.floor(r.x * scale),
      y: Math.floor(r.y * scale),
      width: Math.ceil(r.width * scale),
      height: Math.ceil(r.height * scale),
    }
    fillRect(a, rect, MASK)
    fillRect(b, rect, MASK)
  }

  const diff = new PNG({ width: area.width, height })
  const mismatched = pixelmatch(a.data, b.data, diff.data, area.width, height, { threshold: 0.1 })

  const overlay = new PNG({ width: area.width, height })
  for (let i = 0; i < a.data.length; i++) overlay.data[i] = (a.data[i] + b.data[i]) >> 1

  const side = blank(area.width * 2 + 16, height, [40, 40, 40, 255])
  paste(side, a, 0, 0)
  paste(side, b, area.width + 16, 0)

  writePng(`${OUT}/${name}.side-by-side.png`, side)
  writePng(`${OUT}/${name}.overlay.png`, overlay)
  writePng(`${OUT}/${name}.diff.png`, diff)
  const ratio = mismatched / (area.width * height)
  summary.push({ name, compared: `${area.width}x${height}`, mismatchedPixels: mismatched, mismatchRatio: Number(ratio.toFixed(4)) })
}

writeFileSync(`${OUT}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`)
console.table(summary)
