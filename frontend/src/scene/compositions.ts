import type { PlanetAnchor, Size } from './layout'
import type { PlateId } from './plates'

/**
 * Scene compositions from ARCHITECTURE_MVP_v2 §17.1–17.2a. Each one is plain
 * data so transitions (V1.2: M02 hero → intake) interpolate between two sets
 * of numbers and the owner reviews key frames, not code.
 */
export const compositionNames = ['hero', 'intake', 'review', 'access', 'creation', 'result', 'quiet'] as const

export type CompositionName = (typeof compositionNames)[number]

export type SceneOrientation = 'landscape' | 'portrait'

/**
 * Concentric tilted orbits. Lengths are in planet radii, so the system stays
 * attached to whatever planet the placed plate shows.
 */
export interface OrbitSystem {
  /** Offset of the common centre from the planet centre. */
  center: { x: number; y: number }
  /** Rotation of the major axis, degrees, screen space (y down). */
  tiltDeg: number
  /** Minor / major axis. */
  flattening: number
  /** Semi-major axes. */
  radii: readonly number[]
  /** Line opacity in front of the sky. */
  opacity: number
  /** Opacity factor of the far half where it crosses the planet disk. */
  backOverPlanet: number
  /** Line width in design units. */
  width: number
}

export interface BodySpec {
  kind: 'glow' | 'moon'
  orbit: number
  /** Ellipse parameter at time 0, radians. */
  angle: number
  /** Angular speed of the ambient drift, radians per second. */
  speed: number
  /** Core diameter in design units. */
  size: number
}

export interface SceneComposition {
  plate: PlateId
  design: Size
  planet: PlanetAnchor
  orbits: OrbitSystem
  bodies: readonly BodySpec[]
  /** Procedural twinkling stars per 100 000 px² of viewport. */
  starDensity: number
  /** 1 = full scene; lower values quieten it behind reading screens. */
  intensity: number
  /**
   * Who draws the plate below its groundTop. 'page': the scene keeps only
   * the sky and the planet, and the screen lays the horizon band into its
   * own flow, where it scrolls natively under the text attached to it.
   */
  ground: 'scene' | 'page'
}

/**
 * Reference fit (SCR-01 journal, stage 3): on hero-approved.png the orbits
 * share a centre at (−0.108r, +0.063r) from the planet, tilt −22.5°,
 * flattening 0.41 and semi-major axes 1.087r, 1.517r, 1.947r.
 */
const referenceOrbits: OrbitSystem = {
  center: { x: -0.1082, y: 0.0625 },
  tiltDeg: -22.5,
  flattening: 0.41,
  radii: [1.0865, 1.5168, 1.9471],
  opacity: 0.22,
  backOverPlanet: 0.35,
  width: 1.1,
}

const referenceBodies: readonly BodySpec[] = [
  { kind: 'moon', orbit: 0, angle: 2.804, speed: 0.012, size: 17 },
  { kind: 'glow', orbit: 1, angle: 2.347, speed: 0.008, size: 4.2 },
  { kind: 'glow', orbit: 2, angle: -1.871, speed: 0.0055, size: 4.2 },
]

const heroLandscape: SceneComposition = {
  plate: 'hero-landscape',
  // The reference frame without its border, in CSS pixels at 1440 wide.
  design: { width: 1440, height: 873 },
  planet: { x: 334.5, y: 288.4, r: 294.8, fromRight: true },
  orbits: referenceOrbits,
  bodies: referenceBodies,
  starDensity: 0.9,
  intensity: 1,
  ground: 'scene',
}

// No approved mobile reference exists. Owner decision (variant B, SCR-01
// journal, stage 7): a composition of its own that reads top to bottom —
// planet, copy, then the horizon at the foot of the page.
const heroPortrait: SceneComposition = {
  plate: 'hero-portrait',
  design: { width: 390, height: 844 },
  // Anchored to the right so wider portrait screens (tablets) keep the planet on the right as in the reference.
  planet: { x: 190, y: 188, r: 187, fromRight: true },
  // Quieter than the reference: on phones the orbits cross the eyebrow and the heading.
  orbits: { ...referenceOrbits, opacity: 0.15 },
  // High on their orbits: the copy scrolls up faster than the lingering sky,
  // so a body near the lower limb would soon slide under the eyebrow.
  bodies: [
    { kind: 'moon', orbit: 0, angle: 1.25, speed: 0.012, size: 15 },
    { kind: 'glow', orbit: 1, angle: -0.74, speed: 0.008, size: 4.2 },
    { kind: 'glow', orbit: 2, angle: -1.871, speed: 0.0055, size: 4.2 },
  ],
  starDensity: 0.9,
  intensity: 1,
  ground: 'page',
}

const hero = { landscape: heroLandscape, portrait: heroPortrait }

function quieter(base: typeof hero, intensity: number): typeof hero {
  return {
    landscape: { ...base.landscape, intensity },
    portrait: { ...base.portrait, intensity },
  }
}

/**
 * Only `hero` is calibrated in V1.1. The other screens keep the hero scene
 * until their slices define their own key frames.
 */
export const compositions: Record<CompositionName, Record<SceneOrientation, SceneComposition>> = {
  hero,
  intake: hero,
  review: hero,
  access: hero,
  creation: hero,
  result: hero,
  quiet: quieter(hero, 0.45),
}
