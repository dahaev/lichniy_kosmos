import type { Circle, Plate } from './plates'

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

/**
 * Where the planet should be, in design units of the composition's design
 * frame. One design unit is `u = min(W / design.width, H / design.height)`
 * CSS pixels, so the hero keeps the proportions of the reference on any
 * aspect ratio. `fromRight` anchors x to the right edge of the viewport.
 */
export interface PlanetAnchor {
  x: number
  y: number
  r: number
  fromRight: boolean
}

export interface SceneFrame {
  viewport: Size
  /** CSS pixels per design unit. */
  u: number
  /** Plate rectangle in viewport pixels; always covers the viewport. */
  plate: Rect
  /** Plate pixels → viewport pixels. */
  scale: number
  /** Planet disk in viewport pixels, derived from the placed plate. */
  planet: Circle
  horizonY: number
}

export function designUnit(viewport: Size, design: Size): number {
  return Math.min(viewport.width / design.width, viewport.height / design.height)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Places the plate so its planet lands on the anchor. If that would leave the
 * viewport uncovered the plate is scaled up and shifted as little as needed:
 * coverage wins over planet size, so the planet is the derived quantity and
 * everything attached to it (orbits, bodies, captions) follows the plate.
 */
export function computeFrame(viewport: Size, design: Size, anchor: PlanetAnchor, plate: Plate): SceneFrame {
  const u = designUnit(viewport, design)
  const cover = Math.max(viewport.width / plate.width, viewport.height / plate.height)
  const anchorScale = (anchor.r * u) / plate.planet.r
  const scale = Math.max(cover, anchorScale)
  const width = plate.width * scale
  const height = plate.height * scale

  // A planet grown past its design size to cover the viewport keeps its top
  // edge and its outer limb (the lit rim on fromRight anchors) where the design put them.
  const grow = (scale - anchorScale) * plate.planet.r
  const targetX = anchor.fromRight ? viewport.width - anchor.x * u - grow : anchor.x * u + grow
  const targetY = anchor.y * u + grow
  const x = clamp(targetX - plate.planet.x * scale, viewport.width - width, 0)
  const y = clamp(targetY - plate.planet.y * scale, viewport.height - height, 0)

  return {
    viewport,
    u,
    plate: { x, y, width, height },
    scale,
    planet: { x: x + plate.planet.x * scale, y: y + plate.planet.y * scale, r: plate.planet.r * scale },
    horizonY: y + plate.horizonY * scale,
  }
}
