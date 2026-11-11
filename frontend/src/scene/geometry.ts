import type { BodySpec, OrbitSystem } from './compositions'
import type { Size } from './layout'
import type { Circle } from './plates'

export interface Point {
  x: number
  y: number
}

export interface Ellipse {
  center: Point
  a: number
  b: number
  /** Radians, screen space (y down). */
  tilt: number
}

export function orbitEllipse(planet: Circle, system: OrbitSystem, index: number): Ellipse {
  const radius = system.radii[index]
  if (radius === undefined) throw new RangeError(`orbit ${String(index)} does not exist`)
  const a = radius * planet.r
  return {
    center: { x: planet.x + system.center.x * planet.r, y: planet.y + system.center.y * planet.r },
    a,
    b: a * system.flattening,
    tilt: (system.tiltDeg * Math.PI) / 180,
  }
}

export function pointOnEllipse(e: Ellipse, t: number): Point {
  const u = e.a * Math.cos(t)
  const v = e.b * Math.sin(t)
  const c = Math.cos(e.tilt)
  const s = Math.sin(e.tilt)
  return { x: e.center.x + u * c - v * s, y: e.center.y + u * s + v * c }
}

/** The half with sin t < 0 is the far side: it passes behind the planet. */
export function isFarSide(t: number): boolean {
  return Math.sin(t) < 0
}

/** SVG path of one half of the ellipse: `far` = t ∈ (π, 2π), near = t ∈ (0, π). */
export function halfEllipsePath(e: Ellipse, far: boolean, segments = 96): string {
  const start = far ? Math.PI : 0
  const parts: string[] = []
  for (let i = 0; i <= segments; i++) {
    const p = pointOnEllipse(e, start + (Math.PI * i) / segments)
    parts.push(`${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
  }
  return parts.join(' ')
}

export function bodyPosition(planet: Circle, system: OrbitSystem, body: BodySpec, time: number): Point {
  return pointOnEllipse(orbitEllipse(planet, system, body.orbit), body.angle + body.speed * time)
}

/** Small deterministic PRNG (mulberry32) so the star field is stable between visits and in snapshots. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Star {
  x: number
  y: number
  /** Diameter in CSS pixels. */
  size: number
  alpha: number
  phase: number
  /** Twinkle speed, radians per second. */
  rate: number
}

export function starField(viewport: Size, densityPer100k: number, seed = 20261111): Star[] {
  const random = seededRandom(seed)
  const count = Math.round(((viewport.width * viewport.height) / 100_000) * densityPer100k)
  const stars: Star[] = []
  for (let i = 0; i < count; i++) {
    // Squaring biases towards faint, small stars; a few are brighter.
    const brightness = random() ** 2
    stars.push({
      x: random() * viewport.width,
      y: random() * viewport.height,
      size: 0.8 + brightness * 1.6,
      alpha: 0.25 + brightness * 0.6,
      phase: random() * Math.PI * 2,
      rate: 0.4 + random() * 1.2,
    })
  }
  return stars
}
