import type { components } from '@/api/schema'

/**
 * Shared chart vocabulary for the creation scene (SCR-06), the result page
 * (SCR-07) and, later, the SVG wheel. The geometry itself (`chartGeometry`,
 * `ChartWheel`) is not written yet; this module holds only the types taken
 * from the generated contract and the closed lists of ids, so every consumer
 * agrees on the order of bodies and signs.
 *
 * Nothing here calculates astronomy. Signs, possible signs, intervals,
 * aspects, houses and angles come from the server (SCR-06 §0.0, decision 4).
 */
type Schemas = components['schemas']

export type Chart = Schemas['Chart']
export type ChartMode = Schemas['ChartMode']
export type ChartBody = Schemas['ChartBody']
export type ChartAspect = Schemas['ChartAspect']
export type ChartHouse = Schemas['ChartHouse']
export type ChartAngles = Schemas['ChartAngles']
export type ChartWarning = Schemas['ChartWarning']
export type ChartTimeBasis = Schemas['ChartTimeBasis']
export type LongitudeRange = Schemas['LongitudeRange']
export type BodyId = Schemas['BodyId']
export type SignId = Schemas['SignId']
export type AspectKind = Schemas['AspectKind']

/** Sun → Pluto: the order of `Chart.bodies`. */
export const BODY_IDS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const satisfies readonly BodyId[]

/** Aries → Pisces: the 30° sectors of the tropical zodiac, counted from 0° Aries. */
export const SIGN_IDS = [
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
] as const satisfies readonly SignId[]

/** The five aspects of the base product rules, with their exact angles. */
export const ASPECT_ANGLES = {
  conjunction: 0,
  sextile: 60,
  square: 90,
  trine: 120,
  opposition: 180,
} as const satisfies Record<AspectKind, number>

// Both lists must stay exhaustive: a value added to the contract fails the build here.
type MustBeNever<T extends never> = T
export type BodyIdsAreComplete = MustBeNever<Exclude<BodyId, (typeof BODY_IDS)[number]>>
export type SignIdsAreComplete = MustBeNever<Exclude<SignId, (typeof SIGN_IDS)[number]>>
