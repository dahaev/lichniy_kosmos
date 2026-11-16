import { describe, expect, it } from 'vitest'

import { ASPECT_ANGLES, BODY_IDS, SIGN_IDS, type Chart, type ChartAspect, type ChartBody, type LongitudeRange, type SignId } from '@/chart/types'
import { check, schema } from '@/test/openapi'

import { CHART_FIXTURE_NAMES, chartFixture, FIXTURE_CHART_VERSION, isChartFixtureName, type ChartFixtureName } from './chartFixtures'

/**
 * These checks recompute what the fixtures claim, independently of how the
 * fixtures were written. The 3° below is the fixtures' own convention for
 * which aspects they list; it is NOT an orb (orbs are not approved, Q4).
 */
const FIXTURE_TOLERANCE = 3
const BOUNDARY_NEAR = 0.05

const fullAspectLists: ChartFixtureName[] = ['known', 'polar', 'stellium']
const withHouses: ChartFixtureName[] = ['known', 'stellium']

const signAt = (longitude: number): SignId => SIGN_IDS[Math.floor(longitude / 30)] as SignId
const body = (chart: Chart, id: ChartBody['id']): ChartBody => {
  const found = chart.bodies.find((item) => item.id === id)
  if (!found) throw new Error(`no ${id}`)
  return found
}

/** Distance of two longitudes on the circle, 0–180. */
function separation(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

/** Every pair of bodies within the fixtures' tolerance of an exact aspect angle, keyed `a-b-kind`. */
function nearAspects(chart: Chart): Set<string> {
  const found = new Set<string>()
  chart.bodies.forEach((first, i) => {
    chart.bodies.slice(i + 1).forEach((second) => {
      for (const [kind, angle] of Object.entries(ASPECT_ANGLES)) {
        if (Math.abs(separation(first.reference_longitude, second.reference_longitude) - angle) <= FIXTURE_TOLERANCE) {
          found.add(`${first.id}-${second.id}-${kind}`)
        }
      }
    })
  })
  return found
}

const keyOf = (item: ChartAspect): string => `${item.a}-${item.b}-${item.kind}`

/** Signs touched by an arc of longitudes that runs upward from `from` to `to`, through 0° if `from > to`. */
function signsOfArc(range: LongitudeRange): Set<SignId> {
  const length = (range.to - range.from + 360) % 360
  const signs = new Set<SignId>()
  for (let step = 0; step <= length; step += 0.01) signs.add(signAt((range.from + step) % 360))
  signs.add(signAt(range.to))
  return signs
}

function arcContains(range: LongitudeRange, longitude: number): boolean {
  return (longitude - range.from + 360) % 360 <= (range.to - range.from + 360) % 360
}

describe.each(CHART_FIXTURE_NAMES)('synthetic chart "%s"', (name) => {
  const chart = chartFixture(name)

  it('conforms to the Chart schema of the contract', () => {
    expect(check(schema('Chart'), chart)).toEqual([])
  })

  it('says it is synthetic', () => {
    expect(chart.version).toBe(FIXTURE_CHART_VERSION)
    expect(chart.version).toMatch(/^synthetic-/)
  })

  it('has the ten bodies from Sun to Pluto, once each', () => {
    expect(chart.bodies.map((item) => item.id)).toEqual([...BODY_IDS])
  })

  it('keeps every longitude in [0, 360) and the sign of the reference longitude consistent with it', () => {
    for (const item of chart.bodies) {
      expect(item.reference_longitude).toBeGreaterThanOrEqual(0)
      expect(item.reference_longitude).toBeLessThan(360)
      expect(item.sign, item.id).toBe(signAt(item.reference_longitude))
    }
  })

  it('lists possible signs without repeats and always with the sign of the reference longitude', () => {
    for (const item of chart.bodies) {
      expect(new Set(item.possible_signs).size).toBe(item.possible_signs.length)
      expect(item.possible_signs, item.id).toContain(item.sign)
    }
  })

  it('has aspects between two different known bodies, in body order, without repeated pairs', () => {
    const order = (id: ChartBody['id']): number => BODY_IDS.indexOf(id)
    for (const item of chart.aspects) {
      expect(order(item.a), keyOf(item)).toBeLessThan(order(item.b))
    }
    const pairs = chart.aspects.map((item) => `${item.a}-${item.b}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('draws every aspect between bodies that really stand at that angle (within the fixtures tolerance)', () => {
    const near = nearAspects(chart)
    for (const item of chart.aspects) expect(near.has(keyOf(item)), keyOf(item)).toBe(true)
  })

  it('is not empty of aspects', () => {
    expect(chart.aspects.length).toBeGreaterThan(0)
  })

  it('refers only to existing bodies in its warnings', () => {
    for (const warning of chart.warnings) {
      if (warning.body) expect(BODY_IDS).toContain(warning.body)
    }
  })
})

describe('aspect lists', () => {
  it.each(fullAspectLists)('"%s" lists exactly the pairs within the fixtures tolerance', (name) => {
    const chart = chartFixture(name)

    expect(new Set(chart.aspects.map(keyOf))).toEqual(nearAspects(chart))
  })

  it.each(['range', 'unknown'] as const)('"%s" lists only a stable subset: slow bodies, no Moon', (name) => {
    const chart = chartFixture(name)
    const all = nearAspects(chart)

    expect(chart.aspects.length).toBeLessThan(all.size)
    expect(chart.aspects.filter((item) => item.a === 'moon' || item.b === 'moon')).toEqual([])
  })
})

describe('optional orb of an aspect', () => {
  it('is the real deviation from the exact angle where a fixture carries it', () => {
    const chart = chartFixture('known')

    for (const item of chart.aspects) {
      const first = body(chart, item.a).reference_longitude
      const second = body(chart, item.b).reference_longitude
      expect(item.orb_deg, keyOf(item)).toBeDefined()
      expect(item.orb_deg ?? Number.NaN, keyOf(item)).toBeCloseTo(Math.abs(separation(first, second) - ASPECT_ANGLES[item.kind]), 1)
    }
  })

  it('is absent from the other fixtures: the interface must not need it', () => {
    for (const name of CHART_FIXTURE_NAMES.filter((item) => item !== 'known')) {
      for (const item of chartFixture(name).aspects) expect(item, `${name} ${keyOf(item)}`).not.toHaveProperty('orb_deg')
    }
  })
})

describe('retrograde that the server cannot determine', () => {
  it('is null only in range and unknown, one body each', () => {
    for (const name of ['range', 'unknown'] as const) {
      expect(chartFixture(name).bodies.filter((item) => item.retrograde === null).map((item) => item.id), name).toHaveLength(1)
    }
    for (const name of ['known', 'polar', 'stellium'] as const) {
      for (const item of chartFixture(name).bodies) expect(typeof item.retrograde, `${name} ${item.id}`).toBe('boolean')
    }
  })

  it('is rejected by the contract for a body that is not a boolean or null', () => {
    const chart = chartFixture('range')
    const first = chart.bodies[0]
    if (!first) throw new Error('no body')
    first.retrograde = 'maybe' as unknown as boolean
    expect(check(schema('Chart'), chart)).not.toEqual([])
  })
})

describe('mode and time basis are kept apart', () => {
  it.each([
    ['known', 'known', 'birth_moment'],
    ['polar', 'known', 'birth_moment'],
    ['stellium', 'known', 'birth_moment'],
    ['range', 'range', 'interval_midpoint'],
    ['unknown', 'unknown', 'local_noon'],
  ] as const)('"%s" is %s with the reference moment %s', (name, mode, moment) => {
    const chart = chartFixture(name)

    expect(chart.mode).toBe(mode)
    expect(chart.time_basis.reference_moment).toBe(moment)
  })

  it('carries an uncertainty in minutes only in range', () => {
    expect(chartFixture('range').time_basis.uncertainty_minutes).toBe(60)
    for (const name of CHART_FIXTURE_NAMES.filter((item) => item !== 'range')) {
      expect(chartFixture(name).time_basis, name).not.toHaveProperty('uncertainty_minutes')
    }
  })
})

describe('longitude intervals exist only where they were calculated', () => {
  it('has none in known, unknown, polar and stellium', () => {
    for (const name of ['known', 'unknown', 'polar', 'stellium'] as const) {
      expect(chartFixture(name).bodies.filter((item) => item.longitude_range), name).toEqual([])
    }
  })

  it('has one in range, for the Moon alone, around the reference longitude', () => {
    const withRange = chartFixture('range').bodies.filter((item) => item.longitude_range)
    expect(withRange.map((item) => item.id)).toEqual(['moon'])

    const moon = body(chartFixture('range'), 'moon')
    const arc = moon.longitude_range
    if (!arc) throw new Error('no interval')
    expect(arcContains(arc, moon.reference_longitude)).toBe(true)
    // The reference is the midpoint of the interval of time, and here also of the arc.
    expect(((arc.from + arc.to) / 2).toFixed(2)).toBe(moon.reference_longitude.toFixed(2))
  })

  it('lists, for an interval, every sign it touches among the possible signs', () => {
    const moon = body(chartFixture('range'), 'moon')
    const arc = moon.longitude_range
    if (!arc) throw new Error('no interval')

    expect(moon.possible_signs).toEqual(expect.arrayContaining([...signsOfArc(arc)]))
    expect(signsOfArc(arc).size).toBe(2)
  })

  it('may give possible signs without an interval: unknown does, and draws no interval', () => {
    const moon = body(chartFixture('unknown'), 'moon')

    expect(moon.possible_signs).toEqual(['aries', 'taurus'])
    expect(moon).not.toHaveProperty('longitude_range')
  })

  it('gives every other body a single possible sign', () => {
    for (const name of ['range', 'unknown'] as const) {
      for (const item of chartFixture(name).bodies.filter((entry) => entry.id !== 'moon')) {
        expect(item.possible_signs, `${name} ${item.id}`).toEqual([item.sign])
      }
    }
  })
})

describe('houses and angles', () => {
  it.each(withHouses)('"%s" has 12 houses numbered 1–12 and four angles that agree with them', (name) => {
    const chart = chartFixture(name)
    const houses = chart.houses ?? []

    expect(houses.map((house) => house.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const cusp = (number: number): number => houses.find((house) => house.number === number)?.longitude ?? Number.NaN
    for (const number of [1, 2, 3, 4, 5, 6]) expect(separation(cusp(number), cusp(number + 6))).toBeCloseTo(180, 5)

    const angles = chart.angles
    expect(angles).toBeDefined()
    expect(angles?.asc).toBe(cusp(1))
    expect(angles?.mc).toBe(cusp(10))
    expect(angles?.dsc).toBe(cusp(7))
    expect(angles?.ic).toBe(cusp(4))
  })

  it('has houses that go round the circle in rising order once', () => {
    for (const name of withHouses) {
      const houses = chartFixture(name).houses ?? []
      let total = 0
      houses.forEach((house, index) => {
        const next = houses[(index + 1) % houses.length]?.longitude ?? 0
        const span = (next - house.longitude + 360) % 360
        expect(span, `${name} house ${String(house.number)}`).toBeGreaterThan(0)
        expect(span).toBeLessThan(180)
        total += span
      })
      expect(total).toBeCloseTo(360, 5)
    }
  })

  it('has angles without houses in polar, with the warning that explains the gap', () => {
    const chart = chartFixture('polar')

    expect(chart).not.toHaveProperty('houses')
    expect(chart.angles).toBeDefined()
    expect(chart.warnings).toEqual([{ code: 'houses_unavailable' }])
    expect(separation(chart.angles?.asc ?? 0, chart.angles?.dsc ?? 0)).toBeCloseTo(180, 5)
    expect(separation(chart.angles?.mc ?? 0, chart.angles?.ic ?? 0)).toBeCloseTo(180, 5)
  })

  it('has neither houses nor angles in unknown and range', () => {
    for (const name of ['unknown', 'range'] as const) {
      const chart = chartFixture(name)
      expect(chart, name).not.toHaveProperty('houses')
      expect(chart, name).not.toHaveProperty('angles')
    }
  })

  it('has no houses warning where houses exist', () => {
    for (const name of withHouses) {
      expect(chartFixture(name).warnings.map((warning) => warning.code)).not.toContain('houses_unavailable')
    }
  })
})

describe('stellium', () => {
  it('has at least four bodies within 10° of each other', () => {
    const longitudes = chartFixture('stellium')
      .bodies.map((item) => item.reference_longitude)
      .sort((a, b) => a - b)
    // The narrowest run of four neighbours (this fixture does not cross 0 degrees).
    const spans = longitudes.map((start, i) => (longitudes[i + 3] ?? Number.POSITIVE_INFINITY) - start)

    expect(Math.min(...spans)).toBeLessThanOrEqual(10)
  })

  it('warns about a body at a sign boundary, and that body is at one', () => {
    const chart = chartFixture('stellium')
    const warning = chart.warnings.find((item) => item.code === 'sign_boundary')

    expect(warning?.body).toBe('saturn')
    const distance = Math.min(...[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map((edge) => Math.abs(body(chart, 'saturn').reference_longitude - edge)))
    expect(distance).toBeLessThanOrEqual(BOUNDARY_NEAR)
  })
})

describe('fixture helpers', () => {
  it('hands out independent copies', () => {
    const first = chartFixture('known')
    first.bodies.length = 0
    first.warnings.push({ code: 'houses_unavailable' })

    expect(chartFixture('known').bodies).toHaveLength(10)
    expect(chartFixture('known').warnings).toEqual([])
  })

  it('differs from fixture to fixture', () => {
    const positions = CHART_FIXTURE_NAMES.map((name) => JSON.stringify(chartFixture(name).bodies.map((item) => item.reference_longitude)))

    expect(new Set(positions).size).toBe(CHART_FIXTURE_NAMES.length)
  })

  it('recognises its own names only', () => {
    expect(isChartFixtureName('polar')).toBe(true)
    expect(isChartFixtureName('real')).toBe(false)
    expect(isChartFixtureName(null)).toBe(false)
  })
})
