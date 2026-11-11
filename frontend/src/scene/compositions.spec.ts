import { describe, expect, it } from 'vitest'

import { compositions, type CompositionName, type SceneOrientation } from './compositions'
import type { Size } from './layout'
import { frameOf } from './sceneStore'

// SCR-02 §0.1: the intake camera only tilts and pulls back. The plate is a
// 1280-pixel master with the planet painted on it, so no frame may enlarge
// it past the hero, and no frame may show the cut top edge or the lit
// right edge of the plate. The other edges are veiled.

const intakeSteps: CompositionName[] = ['intake.name', 'intake.date', 'intake.place', 'intake.time']

const viewports: (Size & { orientation: SceneOrientation; reference: boolean })[] = [
  { width: 1440, height: 900, orientation: 'landscape', reference: true },
  { width: 1920, height: 1080, orientation: 'landscape', reference: true },
  { width: 1280, height: 720, orientation: 'landscape', reference: true },
  { width: 1024, height: 768, orientation: 'landscape', reference: true },
  { width: 2560, height: 1080, orientation: 'landscape', reference: true },
  { width: 390, height: 844, orientation: 'portrait', reference: false },
  { width: 375, height: 667, orientation: 'portrait', reference: false },
  { width: 768, height: 1024, orientation: 'portrait', reference: false },
]

describe.each(viewports)('intake frames at $width×$height', (viewport) => {
  const hero = frameOf(viewport, compositions.hero[viewport.orientation])

  it.each(intakeSteps)('%s never enlarges the plate past the hero', (name) => {
    const frame = frameOf(viewport, compositions[name][viewport.orientation])
    expect(frame.scale).toBeLessThanOrEqual(hero.scale + 1e-9)
  })

  it.each(intakeSteps)('%s keeps the top and right plate edges off screen', (name) => {
    const { plate, viewport: size } = frameOf(viewport, compositions[name][viewport.orientation])
    expect(plate.y).toBeLessThanOrEqual(0.5)
    expect(plate.x + plate.width).toBeGreaterThanOrEqual(size.width - 0.5)
  })

  it.each(intakeSteps)('%s leaves the question column free of the planet', (name) => {
    const frame = frameOf(viewport, compositions[name][viewport.orientation])
    if (viewport.reference) {
      // Column: 74.5u from the left, up to 560u wide (SCR-02 §0.4).
      const columnRight = (74.5 + 560) * hero.u
      expect(frame.planet.x - frame.planet.r).toBeGreaterThan(columnRight)
    } else {
      expect(frame.planet.y + frame.planet.r).toBeLessThan(viewport.height * 0.3)
    }
  })
})

describe('intake story', () => {
  it('gives every step a frame of its own', () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const keys = intakeSteps.map((name) => {
        const c = compositions[name][orientation]
        return [c.planet.x, c.planet.y, c.planet.r, c.orbits.tiltDeg, c.orbits.flattening].join('/')
      })
      expect(new Set(keys).size).toBe(intakeSteps.length)
    }
  })

  it('holds the last frame on the review stub so leaving step 04 does not fly back to the hero', () => {
    expect(compositions.review).toBe(compositions['intake.time'])
  })
})
