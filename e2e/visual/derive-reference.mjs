// Builds the comparison frame from the approved hero without touching the
// original: crops the black screenshot frame and masks the app panel that
// overlaps the bottom of the image (also recorded as an ignore region).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { MASK, crop, fillRect, readPng, writePng } from './png.mjs'

const SOURCE = '../docs/frontend/references/hero-approved.png'
const OUT_PNG = 'visual/reference/hero-desktop.png'
const OUT_JSON = 'visual/reference/hero-desktop.json'

const src = readPng(SOURCE)
const sum = (x, y) => {
  const i = (y * src.width + x) * 4
  return src.data[i] + src.data[i + 1] + src.data[i + 2]
}

const midY = Math.floor(src.height / 2)
const midX = Math.floor(src.width / 2)
let left = 0
while (left < src.width && sum(left, midY) === 0) left++
let right = src.width - 1
while (right > 0 && sum(right, midY) === 0) right--
let top = 0
while (top < src.height && sum(midX, top) <= 6) top++
let bottom = src.height - 1
while (bottom > 0 && sum(left + 80, bottom) <= 6) bottom--

// The overlay panel is a flat grey (48,48,48) bar centred at the bottom.
const PANEL = 144
let panelTop = Math.floor(src.height * 0.85)
while (panelTop < src.height - 1 && !(sum(midX, panelTop) === PANEL && sum(midX, panelTop + 1) === PANEL)) panelTop++
const probeY = panelTop + 20
let panelLeft = midX
while (panelLeft > 0 && sum(panelLeft - 1, probeY) === PANEL) panelLeft--
let panelRight = midX
while (panelRight < src.width - 1 && sum(panelRight + 1, probeY) === PANEL) panelRight++

const frame = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
// Margin covers the panel's anti-aliased rounded corners and shadow.
const margin = 8
const ignore = {
  x: panelLeft - margin - frame.x,
  y: panelTop - margin - frame.y,
  width: panelRight - panelLeft + 1 + 2 * margin,
  height: frame.height - (panelTop - margin - frame.y),
}

const sane =
  frame.width > src.width * 0.95 &&
  frame.height > src.height * 0.9 &&
  ignore.width > 0 &&
  ignore.width < frame.width / 2 &&
  ignore.height > 0 &&
  ignore.height < frame.height / 5
if (!sane) {
  console.error('reference bounds look wrong; inspect the source image', { frame, ignore })
  process.exit(1)
}

// The panel hides real hero pixels, so it is masked rather than repainted.
const derived = crop(src, frame)
fillRect(derived, ignore, MASK)
writePng(OUT_PNG, derived)
const meta = {
  source: 'docs/frontend/references/hero-approved.png',
  sourceSha256: createHash('sha256').update(readFileSync(SOURCE)).digest('hex'),
  sourceSize: { width: src.width, height: src.height },
  frame,
  ignore: [{ ...ignore, reason: 'overlay panel of the tool that captured the reference' }],
  note: 'Derived frame for comparison only. Do not use as a production asset.',
}
writeFileSync(OUT_JSON, `${JSON.stringify(meta, null, 2)}\n`)
console.log(`reference: ${OUT_PNG} ${frame.width}x${frame.height}`, { frame, ignore })
