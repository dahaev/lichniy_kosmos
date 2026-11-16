import { ASPECT_ANGLES, type BodyId, type Chart, type ChartAngles, type ChartAspect, type ChartBody, type ChartHouse, type ChartTimeBasis, type ChartWarning, type LongitudeRange, type SignId } from '@/chart/types'

/**
 * SYNTHETIC charts for SCR-06 mocks, tests and screenshots (AGENTS.md, SCR-06
 * §0.11). They are NOT astronomical results: no date, place or ephemeris
 * stands behind any number, and nothing here may be shown as a real chart.
 * The longitudes are arbitrary, picked so that each fixture exercises a
 * case the interface must handle:
 *
 * - `known`    exact time: houses, four angles, aspects with `orb_deg`, an
 *              all-retrograde pair;
 * - `range`    time ±60 min: reference positions at the interval midpoint, one
 *              body with a calculated longitude interval, one body with an
 *              undetermined `retrograde` (null), no houses, no angles;
 * - `unknown`  time unknown: reference positions at local noon, no houses, no
 *              angles, no intervals at all, one body with two possible signs
 *              and one with an undetermined `retrograde` (null);
 * - `polar`    exact time, houses not defined: angles without houses and the
 *              `houses_unavailable` warning;
 * - `stellium` exact time, five bodies within 9° and a body at a sign
 *              boundary: label spreading and the `sign_boundary` warning.
 *
 * Aspects follow a convention of the fixtures only: `known`, `polar` and
 * `stellium` list every pair within 3° of an exact aspect angle; `range` and
 * `unknown` list a hand-picked subset of slow, near-exact pairs and no Moon
 * aspects. That 3° is not an orb: the orbs are not approved (Q4).
 */
export const CHART_FIXTURE_NAMES = ['known', 'range', 'unknown', 'polar', 'stellium'] as const
export type ChartFixtureName = (typeof CHART_FIXTURE_NAMES)[number]

/** The version string of the synthetic fixtures; no real calculation carries it. */
export const FIXTURE_CHART_VERSION = 'synthetic-fixture-v0'

interface BodyOptions {
  /** `null`: the server cannot tell (a reference moment near a station), only in range and unknown. */
  retrograde?: boolean | null
  possibleSigns?: SignId[]
  range?: LongitudeRange
}

function body(id: BodyId, referenceLongitude: number, sign: SignId, options: BodyOptions = {}): ChartBody {
  return {
    id,
    reference_longitude: referenceLongitude,
    sign,
    possible_signs: options.possibleSigns ?? [sign],
    retrograde: options.retrograde === undefined ? false : options.retrograde,
    ...(options.range ? { longitude_range: options.range } : {}),
  }
}

const aspect = (a: BodyId, b: BodyId, kind: ChartAspect['kind']): ChartAspect => ({ a, b, kind })

const round1 = (value: number): number => Math.round(value * 10) / 10

/** Cusps 1–6 given; 7–12 lie opposite them (a property of the house system, not a calculation of ours). */
function houses(first: [number, number, number, number, number, number]): ChartHouse[] {
  const cusps = [...first, ...first.map((cusp) => round1((cusp + 180) % 360))]
  return cusps.map((longitude, index) => ({ number: index + 1, longitude }))
}

/** ASC, MC, DSC, IC from the same cusps. */
function angles(asc: number, mc: number): ChartAngles {
  return { asc, mc, dsc: round1((asc + 180) % 360), ic: round1((mc + 180) % 360) }
}

/**
 * Adds `orb_deg` (the real deviation from the exact angle, two decimals) to
 * every aspect of a fixture. Only `known` carries it: the field is optional,
 * and the other fixtures show the interface without it. This is arithmetic on
 * invented longitudes, not an approved orb (Q4).
 */
function withOrbs(chart: Chart): Chart {
  const longitudeOf = (id: BodyId): number => chart.bodies.find((item) => item.id === id)?.reference_longitude ?? 0
  const aspects = chart.aspects.map((item) => {
    const diff = Math.abs(longitudeOf(item.a) - longitudeOf(item.b)) % 360
    const separation = diff > 180 ? 360 - diff : diff
    return { ...item, orb_deg: Math.round(Math.abs(separation - ASPECT_ANGLES[item.kind]) * 100) / 100 }
  })
  return { ...chart, aspects }
}

const birthMoment: ChartTimeBasis = { reference_moment: 'birth_moment' }

function known(): Chart {
  return withOrbs({
    version: FIXTURE_CHART_VERSION,
    mode: 'known',
    time_basis: birthMoment,
    bodies: [
      body('sun', 71.3, 'gemini'),
      body('moon', 195.8, 'libra'),
      body('mercury', 58.6, 'taurus'),
      body('venus', 103.3, 'cancer'),
      body('mars', 280.9, 'capricorn'),
      body('jupiter', 131.5, 'leo'),
      body('saturn', 251.7, 'sagittarius', { retrograde: true }),
      body('uranus', 313.4, 'aquarius', { retrograde: true }),
      body('neptune', 340.2, 'pisces'),
      body('pluto', 262.6, 'sagittarius'),
    ],
    aspects: [
      aspect('sun', 'jupiter', 'sextile'),
      aspect('sun', 'saturn', 'opposition'),
      aspect('sun', 'uranus', 'trine'),
      aspect('sun', 'neptune', 'square'),
      aspect('moon', 'venus', 'square'),
      aspect('moon', 'uranus', 'trine'),
      aspect('venus', 'mars', 'opposition'),
      aspect('mars', 'neptune', 'sextile'),
      aspect('jupiter', 'saturn', 'trine'),
      aspect('jupiter', 'uranus', 'opposition'),
      aspect('saturn', 'uranus', 'sextile'),
      aspect('saturn', 'neptune', 'square'),
    ],
    houses: houses([164.7, 190.1, 224.9, 260.3, 291.4, 322.0]),
    angles: angles(164.7, 80.3),
    warnings: [],
  })
}

function range(): Chart {
  return {
    version: FIXTURE_CHART_VERSION,
    mode: 'range',
    time_basis: { reference_moment: 'interval_midpoint', uncertainty_minutes: 60 },
    bodies: [
      body('sun', 5.2, 'aries'),
      // The only calculated interval of the fixture; its midpoint is the reference longitude.
      body('moon', 29.85, 'aries', { possibleSigns: ['aries', 'taurus'], range: { from: 29.3, to: 30.4 } }),
      // Near a station at the reference moment: the server cannot say.
      body('mercury', 350.7, 'pisces', { retrograde: null }),
      body('venus', 35, 'taurus'),
      body('mars', 125.3, 'leo'),
      body('jupiter', 215.6, 'scorpio'),
      body('saturn', 95, 'cancer'),
      body('uranus', 305.9, 'aquarius'),
      body('neptune', 185.4, 'libra', { retrograde: true }),
      body('pluto', 66.1, 'gemini'),
    ],
    aspects: [
      aspect('sun', 'mars', 'trine'),
      aspect('sun', 'saturn', 'square'),
      aspect('venus', 'saturn', 'sextile'),
      aspect('jupiter', 'saturn', 'trine'),
      aspect('uranus', 'pluto', 'trine'),
    ],
    warnings: [],
  }
}

function unknown(): Chart {
  return {
    version: FIXTURE_CHART_VERSION,
    mode: 'unknown',
    time_basis: { reference_moment: 'local_noon' },
    bodies: [
      body('sun', 160.4, 'virgo'),
      // Two possible signs, but the server sent no longitude interval: none may be drawn.
      body('moon', 29.4, 'aries', { possibleSigns: ['aries', 'taurus'] }),
      body('mercury', 150.1, 'virgo', { retrograde: null }),
      body('venus', 190.8, 'libra'),
      body('mars', 10.2, 'aries'),
      body('jupiter', 250, 'sagittarius', { retrograde: true }),
      body('saturn', 340.3, 'pisces'),
      body('uranus', 70.5, 'gemini'),
      body('neptune', 281.9, 'capricorn'),
      body('pluto', 220.6, 'scorpio'),
    ],
    aspects: [
      aspect('mars', 'jupiter', 'trine'),
      aspect('mars', 'uranus', 'sextile'),
      aspect('jupiter', 'saturn', 'square'),
      aspect('jupiter', 'uranus', 'opposition'),
      aspect('saturn', 'uranus', 'square'),
      aspect('saturn', 'pluto', 'trine'),
    ],
    warnings: [],
  }
}

function polar(): Chart {
  return {
    version: FIXTURE_CHART_VERSION,
    mode: 'known',
    time_basis: birthMoment,
    bodies: [
      body('sun', 34.1, 'taurus'),
      body('moon', 266.4, 'sagittarius'),
      body('mercury', 48.9, 'taurus'),
      body('venus', 3.7, 'aries'),
      body('mars', 148.2, 'leo', { retrograde: true }),
      body('jupiter', 91, 'cancer'),
      body('saturn', 330.5, 'pisces'),
      body('uranus', 184.6, 'libra'),
      body('neptune', 12.8, 'aries'),
      body('pluto', 273.3, 'capricorn', { retrograde: true }),
    ],
    aspects: [
      aspect('sun', 'pluto', 'trine'),
      aspect('moon', 'mars', 'trine'),
      aspect('venus', 'jupiter', 'square'),
      aspect('venus', 'uranus', 'opposition'),
      aspect('venus', 'pluto', 'square'),
      aspect('mars', 'jupiter', 'sextile'),
      aspect('mars', 'saturn', 'opposition'),
      aspect('jupiter', 'saturn', 'trine'),
      aspect('jupiter', 'pluto', 'opposition'),
      aspect('saturn', 'pluto', 'sextile'),
      aspect('uranus', 'pluto', 'square'),
    ],
    angles: angles(200.5, 110.2),
    warnings: [{ code: 'houses_unavailable' }],
  }
}

function stellium(): Chart {
  const warnings: ChartWarning[] = [{ code: 'sign_boundary', body: 'saturn' }]
  return {
    version: FIXTURE_CHART_VERSION,
    mode: 'known',
    time_basis: birthMoment,
    bodies: [
      body('sun', 101.2, 'cancer'),
      body('moon', 215, 'scorpio'),
      body('mercury', 104.9, 'cancer'),
      body('venus', 98.6, 'cancer'),
      body('mars', 107.7, 'cancer'),
      body('jupiter', 100.1, 'cancer'),
      // 0.01° before 0° Taurus: a synthetic boundary case, not a margin rule (Q4).
      body('saturn', 29.99, 'aries'),
      body('uranus', 296.2, 'capricorn'),
      body('neptune', 57.5, 'taurus', { retrograde: true }),
      body('pluto', 160.9, 'virgo'),
    ],
    aspects: [
      aspect('sun', 'venus', 'conjunction'),
      aspect('sun', 'jupiter', 'conjunction'),
      aspect('sun', 'pluto', 'sextile'),
      aspect('mercury', 'mars', 'conjunction'),
      aspect('venus', 'jupiter', 'conjunction'),
      aspect('venus', 'pluto', 'sextile'),
      aspect('jupiter', 'pluto', 'sextile'),
      aspect('uranus', 'neptune', 'trine'),
    ],
    houses: houses([246.3, 271.9, 305.4, 340.8, 12.1, 44.6]),
    angles: angles(246.3, 160.8),
    warnings,
  }
}

const builders: Record<ChartFixtureName, () => Chart> = { known, range, unknown, polar, stellium }

/** A fresh copy of a synthetic chart; callers may change it freely. */
export function chartFixture(name: ChartFixtureName): Chart {
  return builders[name]()
}

export function isChartFixtureName(value: string | null | undefined): value is ChartFixtureName {
  return CHART_FIXTURE_NAMES.some((name) => name === value)
}
