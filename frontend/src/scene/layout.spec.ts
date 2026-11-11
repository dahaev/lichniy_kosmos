import { describe, expect, it } from 'vitest'

import { compositions } from './compositions'
import { computeFrame } from './layout'
import { plates } from './plates'

const hero = compositions.hero.landscape
const plate = plates[hero.plate]

function covers(frame: ReturnType<typeof computeFrame>): boolean {
  const { x, y, width, height } = frame.plate
  return x <= 0 && y <= 0 && x + width >= frame.viewport.width - 0.01 && y + height >= frame.viewport.height - 0.01
}

describe('computeFrame', () => {
  it('reproduces the reference planet in the reference frame', () => {
    const frame = computeFrame({ width: 1440, height: 873 }, hero.design, hero.planet, plate)

    expect(frame.u).toBe(1)
    expect(frame.planet.x).toBeCloseTo(1105.5, 1)
    expect(frame.planet.y).toBeCloseTo(288.4, 1)
    expect(frame.planet.r).toBeCloseTo(294.8, 1)
    expect(covers(frame)).toBe(true)
  })

  it.each([
    [1440, 900],
    [1920, 1080],
    [1280, 720],
    [2560, 1080],
    [1024, 768],
  ])('keeps the plate covering a %ix%i viewport', (width, height) => {
    expect(covers(computeFrame({ width, height }, hero.design, hero.planet, plate))).toBe(true)
  })

  it('scales the planet with the design unit on a wider screen', () => {
    const frame = computeFrame({ width: 1920, height: 1080 }, hero.design, hero.planet, plate)

    expect(frame.u).toBeCloseTo(1080 / 873, 5)
    expect(frame.planet.r).toBeCloseTo(294.8 * frame.u, 1)
    expect(frame.planet.x).toBeCloseTo(1920 - 334.5 * frame.u, 1)
  })

  it('places the portrait planet in the upper part of a phone screen', () => {
    const portrait = compositions.hero.portrait
    const frame = computeFrame({ width: 390, height: 844 }, portrait.design, portrait.planet, plates[portrait.plate])

    expect(covers(frame)).toBe(true)
    expect(frame.planet.y + frame.planet.r).toBeLessThan(844 / 2)
  })

  it('keeps the top edge and the lit rim on screen when covering grows the planet', () => {
    const portrait = compositions.hero.portrait
    const frame = computeFrame({ width: 768, height: 1024 }, portrait.design, portrait.planet, plates[portrait.plate])
    const designed = portrait.planet.r * frame.u

    expect(frame.planet.r).toBeGreaterThan(designed)
    expect(covers(frame)).toBe(true)
    expect(frame.planet.y - frame.planet.r).toBeGreaterThanOrEqual(-1)
    expect(frame.planet.x + frame.planet.r).toBeLessThanOrEqual(768)
  })
})
