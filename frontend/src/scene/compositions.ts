import type { PlanetAnchor, Size } from './layout'
import type { PlateId } from './plates'

/**
 * Scene compositions from ARCHITECTURE_MVP_v2 §17.1–17.2a. Each one is plain
 * data, so a transition interpolates between two sets of numbers and the
 * owner reviews key frames, not code. The intake steps have one key frame
 * each (SCR-02 journal, §0.3).
 */
export const compositionNames = [
  'hero',
  'intake.name',
  'intake.date',
  'intake.place',
  'intake.time',
  'review',
  'access',
  'creation',
  'result',
  'quiet',
] as const

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
  /**
   * 'cover': the plate always covers the viewport and may grow past the
   * anchor to do so (the approved hero). 'free': the planet lands exactly on
   * the anchor; edges the plate leaves open are veiled into the sky colour.
   */
  coverage: 'cover' | 'free'
  orbits: OrbitSystem
  bodies: readonly BodySpec[]
  /** Added to every body angle: between key frames bodies travel along their orbits. */
  bodyPhase: number
  /** Body size relative to its design size; follows the planet when the camera pulls back. */
  bodyScale: number
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
  /** 1 = haze, mountains and water as painted; 0 = veiled in the sky colour. */
  groundReveal: number
  /** Opacity of the veil over plate edges a 'free' placement brings into view. */
  edgeVeil: number
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
  coverage: 'cover',
  orbits: referenceOrbits,
  bodies: referenceBodies,
  bodyPhase: 0,
  bodyScale: 1,
  starDensity: 0.9,
  intensity: 1,
  ground: 'scene',
  groundReveal: 1,
  edgeVeil: 0,
}

// No approved mobile reference exists. Owner decision (variant B, SCR-01
// journal, stage 7): a composition of its own that reads top to bottom —
// planet, copy, then the horizon at the foot of the page.
const heroPortrait: SceneComposition = {
  plate: 'hero-portrait',
  design: { width: 390, height: 844 },
  // Anchored to the right so wider portrait screens (tablets) keep the planet on the right as in the reference.
  planet: { x: 190, y: 188, r: 187, fromRight: true },
  coverage: 'cover',
  // Quieter than the reference: on phones the orbits cross the eyebrow and the heading.
  orbits: { ...referenceOrbits, opacity: 0.15 },
  // High on their orbits: the copy scrolls up faster than the lingering sky,
  // so a body near the lower limb would soon slide under the eyebrow.
  bodies: [
    { kind: 'moon', orbit: 0, angle: 1.25, speed: 0.012, size: 15 },
    { kind: 'glow', orbit: 1, angle: -0.74, speed: 0.008, size: 4.2 },
    { kind: 'glow', orbit: 2, angle: -1.871, speed: 0.0055, size: 4.2 },
  ],
  bodyPhase: 0,
  bodyScale: 1,
  starDensity: 0.9,
  intensity: 1,
  ground: 'page',
  groundReveal: 0,
  edgeVeil: 0,
}

const hero = { landscape: heroLandscape, portrait: heroPortrait }

interface IntakeFrame {
  planet: Omit<PlanetAnchor, 'fromRight'>
  tiltDeg: number
  flattening: number
  bodyPhase: number
  groundReveal: number
  starDensity: number
}

/**
 * The camera of the intake can only tilt and pull back (SCR-02 journal,
 * §0.1): the planet shares one plate with the horizon, and the master is too
 * small to enlarge. So every key frame keeps the planet at most as large as
 * on the hero, and the planet only ever moves up and to the right of where
 * the plate would expose its cut top edge or its lit right edge.
 */
function intakeFrame(base: SceneComposition, frame: IntakeFrame, orbitOpacity: number): SceneComposition {
  return {
    ...base,
    planet: { ...frame.planet, fromRight: true },
    coverage: 'free',
    orbits: { ...base.orbits, tiltDeg: frame.tiltDeg, flattening: frame.flattening, opacity: orbitOpacity },
    bodyPhase: frame.bodyPhase,
    bodyScale: frame.planet.r / base.planet.r,
    starDensity: frame.starDensity,
    ground: 'scene',
    groundReveal: frame.groundReveal,
    edgeVeil: 1,
  }
}

// Key frames of SCR-02 §0.3: name — the camera rose over the horizon; date —
// the system turns, bodies pass part of their orbits; place — the camera
// comes down to the ground again; time — highest, orbits opened like a dial.
const intakeLandscape = {
  name: { planet: { x: 300, y: 250, r: 262 }, tiltDeg: -12, flattening: 0.56, bodyPhase: 0.35, groundReveal: 0.25, starDensity: 0.9 },
  date: { planet: { x: 252, y: 204, r: 232 }, tiltDeg: 14, flattening: 0.5, bodyPhase: 1.25, groundReveal: 0, starDensity: 0.9 },
  place: { planet: { x: 322, y: 270, r: 280 }, tiltDeg: -18, flattening: 0.38, bodyPhase: 1.6, groundReveal: 1, starDensity: 0.9 },
  time: { planet: { x: 232, y: 196, r: 206 }, tiltDeg: 0, flattening: 0.8, bodyPhase: 2.4, groundReveal: 0, starDensity: 0.9 },
} satisfies Record<string, IntakeFrame>

// Phones: the planet rises into the top right corner, its lit limb on the
// right edge as on the hero; the question starts under it, above the keyboard.
const intakePortrait = {
  name: { planet: { x: 150, y: 20, r: 152 }, tiltDeg: -14, flattening: 0.52, bodyPhase: 0.35, groundReveal: 0, starDensity: 0.9 },
  date: { planet: { x: 136, y: 30, r: 138 }, tiltDeg: 12, flattening: 0.48, bodyPhase: 1.25, groundReveal: 0, starDensity: 0.9 },
  place: { planet: { x: 160, y: 8, r: 160 }, tiltDeg: -18, flattening: 0.4, bodyPhase: 1.6, groundReveal: 0.35, starDensity: 0.9 },
  time: { planet: { x: 120, y: 26, r: 122 }, tiltDeg: 0, flattening: 0.78, bodyPhase: 2.4, groundReveal: 0, starDensity: 0.9 },
} satisfies Record<string, IntakeFrame>

function intake(step: keyof typeof intakeLandscape) {
  return {
    // The question column needs a quieter sky than the hero lead.
    landscape: intakeFrame(heroLandscape, intakeLandscape[step], 0.18),
    portrait: intakeFrame(heroPortrait, intakePortrait[step], 0.13),
  }
}

function quieter(base: typeof hero, intensity: number): typeof hero {
  return {
    landscape: { ...base.landscape, intensity },
    portrait: { ...base.portrait, intensity },
  }
}

const intakeTime = intake('time')

/**
 * The hero and the intake steps are calibrated (V1.1, V1.2). The review
 * stub holds the last intake frame so leaving step 04 does not fly the
 * camera back to the hero; other screens keep the hero scene until their
 * slices define their own key frames.
 */
export const compositions: Record<CompositionName, Record<SceneOrientation, SceneComposition>> = {
  hero,
  'intake.name': intake('name'),
  'intake.date': intake('date'),
  'intake.place': intake('place'),
  'intake.time': intakeTime,
  review: intakeTime,
  access: hero,
  creation: hero,
  result: hero,
  quiet: quieter(hero, 0.45),
}
