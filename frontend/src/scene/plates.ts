import meta from './plates/plates.json'

/** Scene plates exported by scripts/build-scene-plates.mjs from assets-src/. */
export type PlateId = 'hero-landscape' | 'hero-portrait'

export interface Circle {
  x: number
  y: number
  r: number
}

export interface Plate {
  id: PlateId
  /** Temporary AI plate (decision Q16): replaced before slice 11. */
  temporary: boolean
  width: number
  height: number
  /** Planet disk in plate pixels. */
  planet: Circle
  /** Waterline in plate pixels. */
  horizonY: number
  /** First row of haze, mountains and water below the sky. */
  groundTop: number
  /** Rows above groundTop over which the sky colour veils the ground when a composition hides it. */
  groundFade: number
  /**
   * Rows below groundTop over which the veil keeps easing into the sky colour
   * (SCR-02 Ж12). 0 keeps the plain linear veil that ends at groundTop.
   */
  groundFeather: number
  srcset: { avif: string; webp: string }
  /** Largest WebP, for <img src>. */
  src: string
}

const urls = import.meta.glob<string>('./plates/*.{avif,webp}', { eager: true, query: '?url', import: 'default' })

function url(file: string): string {
  const found = urls[`./plates/${file}`]
  if (found === undefined) throw new Error(`scene plate ${file} is missing; run scripts/build-scene-plates.mjs`)
  return found
}

// Art direction, not export data: the approved portrait frames keep their veil.
const groundFeather: Record<PlateId, number> = { 'hero-landscape': 90, 'hero-portrait': 0 }

function toPlate(entry: (typeof meta.plates)[number]): Plate {
  const sizes = Object.entries(entry.files)
    .map(([width, files]) => ({ width: Number(width), files }))
    .sort((a, b) => a.width - b.width)
  const largest = sizes.at(-1)
  if (!largest) throw new Error(`scene plate ${entry.id} has no exported sizes`)
  return {
    id: entry.id as PlateId,
    temporary: entry.temporary,
    width: entry.width,
    height: entry.height,
    planet: entry.planet,
    horizonY: entry.horizonY,
    groundTop: entry.groundTop,
    groundFade: entry.groundFade,
    groundFeather: groundFeather[entry.id as PlateId],
    srcset: {
      avif: sizes.map((s) => `${url(s.files.avif)} ${String(s.width)}w`).join(', '),
      webp: sizes.map((s) => `${url(s.files.webp)} ${String(s.width)}w`).join(', '),
    },
    src: url(largest.files.webp),
  }
}

export const plates = Object.fromEntries(meta.plates.map((entry) => [entry.id, toPlate(entry)])) as Record<PlateId, Plate>
