import { describe, expect, it } from 'vitest'

import { compositions } from './compositions'
import { bodyPosition, isFarSide, orbitEllipse, pointOnEllipse, seededRandom, starField } from './geometry'

const hero = compositions.hero.landscape
// Reference planet in the 1440×873 frame.
const planet = { x: 1105.5, y: 288.4, r: 294.8 }

describe('orbit geometry', () => {
  it('puts the bodies where hero-approved.png shows them', () => {
    // Reference positions converted to CSS pixels of the frame.
    const expected = [
      { x: 808.6, y: 464.2 },
      { x: 835.0, y: 546.4 },
      { x: 829.9, y: 163.7 },
    ]
    hero.bodies.forEach((body, i) => {
      const p = bodyPosition(planet, hero.orbits, body, 0)
      const want = expected[i]
      expect(want).toBeDefined()
      if (!want) return
      expect(Math.hypot(p.x - want.x, p.y - want.y)).toBeLessThan(4)
    })
  })

  it('marks the upper half of each orbit as the far side', () => {
    const e = orbitEllipse(planet, hero.orbits, 0)
    expect(isFarSide(-Math.PI / 2)).toBe(true)
    expect(isFarSide(Math.PI / 2)).toBe(false)
    expect(pointOnEllipse(e, -Math.PI / 2).y).toBeLessThan(pointOnEllipse(e, Math.PI / 2).y)
  })
})

describe('star field', () => {
  it('is deterministic for a seed', () => {
    const a = starField({ width: 800, height: 600 }, 1, 7)
    const b = starField({ width: 800, height: 600 }, 1, 7)
    expect(a).toEqual(b)
    expect(a.length).toBe(Math.round(4.8))
  })

  it('stays inside the unit interval', () => {
    const random = seededRandom(1)
    for (let i = 0; i < 1000; i++) {
      const v = random()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
