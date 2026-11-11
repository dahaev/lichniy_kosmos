import type { CubicBezier } from '@/motion/tokens'

import type { OrbitSystem, SceneComposition } from './compositions'
import type { Point } from './geometry'
import type { SceneFrame } from './layout'
import type { Circle } from './plates'

/**
 * Everything a camera move changes, in viewport pixels. A transition mixes
 * two snapshots; the plate, the orbits, the bodies and the veils are all
 * derived from the mixed planet, so they never drift apart mid-flight.
 */
export interface SceneSnapshot {
  planet: Circle
  /** Design unit of the viewport; orbit widths and body sizes are in it. */
  u: number
  orbits: OrbitSystem
  bodyPhase: number
  bodyScale: number
  intensity: number
  groundReveal: number
  edgeVeil: number
  /** Star field offset: stars travel 0.3 of the planet's travel, so they read as farther away. */
  stars: Point
}

/** Depth of the star field relative to the plate. */
export const STAR_DEPTH = 0.3

export function snapshotOf(frame: SceneFrame, composition: SceneComposition, origin: Point): SceneSnapshot {
  return {
    planet: { ...frame.planet },
    u: frame.u,
    orbits: { ...composition.orbits, center: { ...composition.orbits.center }, radii: [...composition.orbits.radii] },
    bodyPhase: composition.bodyPhase,
    bodyScale: composition.bodyScale,
    intensity: composition.intensity,
    groundReveal: composition.groundReveal,
    edgeVeil: composition.edgeVeil,
    stars: { x: (frame.planet.x - origin.x) * STAR_DEPTH, y: (frame.planet.y - origin.y) * STAR_DEPTH },
  }
}

/**
 * `base + (b − a)·t` for every channel. With base = a it mixes two snapshots;
 * with another base it adds the travel from a to b, e.g. a velocity.
 */
function blend(base: SceneSnapshot, a: SceneSnapshot, b: SceneSnapshot, t: number): SceneSnapshot {
  const f = (o: number, x: number, y: number) => o + (y - x) * t
  const sameRings = base.orbits.radii.length === b.orbits.radii.length && a.orbits.radii.length === b.orbits.radii.length
  return {
    planet: { x: f(base.planet.x, a.planet.x, b.planet.x), y: f(base.planet.y, a.planet.y, b.planet.y), r: f(base.planet.r, a.planet.r, b.planet.r) },
    u: f(base.u, a.u, b.u),
    orbits: {
      center: { x: f(base.orbits.center.x, a.orbits.center.x, b.orbits.center.x), y: f(base.orbits.center.y, a.orbits.center.y, b.orbits.center.y) },
      tiltDeg: f(base.orbits.tiltDeg, a.orbits.tiltDeg, b.orbits.tiltDeg),
      flattening: f(base.orbits.flattening, a.orbits.flattening, b.orbits.flattening),
      radii: sameRings ? b.orbits.radii.map((r, i) => f(base.orbits.radii[i] ?? r, a.orbits.radii[i] ?? r, r)) : b.orbits.radii,
      opacity: f(base.orbits.opacity, a.orbits.opacity, b.orbits.opacity),
      backOverPlanet: f(base.orbits.backOverPlanet, a.orbits.backOverPlanet, b.orbits.backOverPlanet),
      width: f(base.orbits.width, a.orbits.width, b.orbits.width),
    },
    bodyPhase: f(base.bodyPhase, a.bodyPhase, b.bodyPhase),
    bodyScale: f(base.bodyScale, a.bodyScale, b.bodyScale),
    intensity: f(base.intensity, a.intensity, b.intensity),
    groundReveal: f(base.groundReveal, a.groundReveal, b.groundReveal),
    edgeVeil: f(base.edgeVeil, a.edgeVeil, b.edgeVeil),
    stars: { x: f(base.stars.x, a.stars.x, b.stars.x), y: f(base.stars.y, a.stars.y, b.stars.y) },
  }
}

/**
 * Mixes two snapshots. Orbit systems with a different number of rings keep
 * the rings of `b`: compositions of one orientation always share their rings.
 */
export function mixSnapshots(a: SceneSnapshot, b: SceneSnapshot, t: number): SceneSnapshot {
  if (t <= 0) return a
  if (t >= 1) return b
  return blend(a, a, b, t)
}

/** `base` moved by `k` times the change from `a` to `b`; `k` may be any number. */
export function addTravel(base: SceneSnapshot, a: SceneSnapshot, b: SceneSnapshot, k: number): SceneSnapshot {
  return k === 0 ? base : blend(base, a, b, k)
}

/** Shifts a snapshot vertically, e.g. by how far a scrolled page had carried the sky. */
export function shiftSnapshot(s: SceneSnapshot, dy: number): SceneSnapshot {
  return { ...s, planet: { ...s.planet, y: s.planet.y + dy }, stars: { x: s.stars.x, y: s.stars.y + dy } }
}

/**
 * CSS cubic-bezier as a function of time, solved for x by Newton steps with
 * a bisection fallback, the way browsers evaluate transition timing.
 */
export function cubicBezier([x1, y1, x2, y2]: CubicBezier): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx

  function solve(x: number): number {
    let s = x
    for (let i = 0; i < 8; i++) {
      const error = sampleX(s) - x
      if (Math.abs(error) < 1e-6) return s
      const slope = slopeX(s)
      if (Math.abs(slope) < 1e-6) break
      s -= error / slope
    }
    let lo = 0
    let hi = 1
    s = x
    while (hi - lo > 1e-6) {
      if (sampleX(s) < x) lo = s
      else hi = s
      s = (lo + hi) / 2
    }
    return s
  }

  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    return sampleY(solve(t))
  }
}
