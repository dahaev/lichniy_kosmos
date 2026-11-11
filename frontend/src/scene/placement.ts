import type { SceneSnapshot } from './interpolate'
import type { Plate } from './plates'

/**
 * Where the painted plate goes for a snapshot. The plate box keeps one
 * layout size and is moved by one transform, so a camera move animates only
 * transform and opacity (compositor-only, ARCHITECTURE_MVP_v2 §17.5).
 */
export interface PlatePlacement {
  x: number
  y: number
  scale: number
  /** Opacity of the sky-coloured veil over haze, mountains and water. */
  groundVeil: number
  /** Opacity of the veils over the left and bottom edges of the plate. */
  edgeVeil: number
}

export function platePlacement(snapshot: SceneSnapshot, plate: Plate): PlatePlacement {
  const scale = snapshot.planet.r / plate.planet.r
  return {
    x: snapshot.planet.x - plate.planet.x * scale,
    y: snapshot.planet.y - plate.planet.y * scale,
    scale,
    groundVeil: 1 - snapshot.groundReveal,
    edgeVeil: snapshot.edgeVeil,
  }
}

/**
 * The box is laid out at `base` (the scale of the frame at rest), so at rest
 * the plate is a plain translated image, rasterised exactly as on the
 * approved hero. Only a camera move adds a scale on top.
 */
export function plateTransform({ x, y, scale }: PlatePlacement, base: number): string {
  const translate = `translate(${String(x)}px, ${String(y)}px)`
  const relative = scale / base
  return Math.abs(relative - 1) < 1e-9 ? translate : `${translate} scale(${String(relative)})`
}
