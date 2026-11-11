import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PNG } from 'pngjs'

/** Colour of regions excluded from comparison. */
export const MASK = [255, 0, 255, 255]

export function readPng(file) {
  return PNG.sync.read(readFileSync(file))
}

export function writePng(file, png) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, PNG.sync.write(png))
}

export function crop(src, { x, y, width, height }) {
  const out = new PNG({ width, height })
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * src.width + x) * 4
    src.data.copy(out.data, row * width * 4, from, from + width * 4)
  }
  return out
}

/** Bilinear resize; good enough for reference-vs-snapshot inspection. */
export function resize(src, width, height) {
  const out = new PNG({ width, height })
  const sx = src.width / width
  const sy = src.height / height
  for (let y = 0; y < height; y++) {
    const fy = Math.min((y + 0.5) * sy - 0.5, src.height - 1)
    const y0 = Math.max(Math.floor(fy), 0)
    const y1 = Math.min(y0 + 1, src.height - 1)
    const ty = Math.max(fy - y0, 0)
    for (let x = 0; x < width; x++) {
      const fx = Math.min((x + 0.5) * sx - 0.5, src.width - 1)
      const x0 = Math.max(Math.floor(fx), 0)
      const x1 = Math.min(x0 + 1, src.width - 1)
      const tx = Math.max(fx - x0, 0)
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c]
        const b = src.data[(y0 * src.width + x1) * 4 + c]
        const d = src.data[(y1 * src.width + x0) * 4 + c]
        const e = src.data[(y1 * src.width + x1) * 4 + c]
        const top = a + (b - a) * tx
        const bottom = d + (e - d) * tx
        out.data[(y * width + x) * 4 + c] = Math.round(top + (bottom - top) * ty)
      }
    }
  }
  return out
}

export function blank(width, height, rgba = [0, 0, 0, 255]) {
  const out = new PNG({ width, height })
  for (let i = 0; i < width * height; i++) out.data.set(rgba, i * 4)
  return out
}

export function paste(dst, src, ox, oy) {
  for (let row = 0; row < src.height && oy + row < dst.height; row++) {
    const w = Math.min(src.width, dst.width - ox)
    const from = row * src.width * 4
    src.data.copy(dst.data, ((oy + row) * dst.width + ox) * 4, from, from + w * 4)
  }
}

export function fillRect(png, { x, y, width, height }, rgba) {
  for (let row = Math.max(y, 0); row < Math.min(y + height, png.height); row++) {
    for (let col = Math.max(x, 0); col < Math.min(x + width, png.width); col++) {
      png.data.set(rgba, (row * png.width + col) * 4)
    }
  }
}
