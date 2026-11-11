// Joins the key frames of intake.spec.ts into one strip per viewport for
// owner review: the hero → name flight and the intake → hero return (Ж11).
// node visual/strip.mjs
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'

import { readPng, resize, writePng } from './png.mjs'

const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'output')
const sets = [
  { dir: 'flight', frames: ['000', '035', '070', '100'] },
  { dir: 'return', frames: ['0', '1', '2', '3'] },
]
const gap = 12

for (const { dir, frames } of sets) {
  for (const viewport of ['desktop-1440', 'mobile-390']) {
    const files = frames.map((f) => path.join(output, dir, `${viewport}-${f}.png`))
    if (!files.every((f) => existsSync(f))) {
      console.log(`${dir} ${viewport}: frames missing, run the visual project first`)
      continue
    }
    const scale = viewport.startsWith('desktop') ? 0.5 : 0.75
    const images = files.map((f) => {
      const png = readPng(f)
      return resize(png, Math.round(png.width * scale), Math.round(png.height * scale))
    })
    const height = Math.max(...images.map((i) => i.height))
    const width = images.reduce((sum, i) => sum + i.width, 0) + gap * (images.length - 1)
    const strip = new PNG({ width, height })
    strip.data.fill(255)
    let x = 0
    for (const image of images) {
      PNG.bitblt(image, strip, 0, 0, image.width, image.height, x, 0)
      x += image.width + gap
    }
    const out = path.join(output, dir, `${viewport}-strip.png`)
    writePng(out, strip)
    console.log(`${dir} ${viewport}: ${path.relative(process.cwd(), out)}`)
  }
}
