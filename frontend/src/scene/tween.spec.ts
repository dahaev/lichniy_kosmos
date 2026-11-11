import { describe, expect, it } from 'vitest'

import { easings } from '@/motion/tokens'

import { compositions } from './compositions'
import { cubicBezier, mixSnapshots, snapshotOf, STAR_DEPTH } from './interpolate'
import { frameOf } from './sceneStore'
import { SnapshotTween } from './tween'

const viewport = { width: 1440, height: 900 }
const at = (name: keyof typeof compositions) => {
  const composition = compositions[name].landscape
  const hero = frameOf(viewport, compositions.hero.landscape)
  return snapshotOf(frameOf(viewport, composition), composition, hero.planet)
}

describe('cubicBezier', () => {
  it('hits the ends and matches CSS linear', () => {
    const linear = cubicBezier([0, 0, 1, 1])
    expect(linear(0)).toBe(0)
    expect(linear(1)).toBe(1)
    expect(linear(0.3)).toBeCloseTo(0.3, 5)
  })

  it('is monotonic for the cinematic curve and moves at once after the click', () => {
    const ease = cubicBezier(easings.cinematic)
    let previous = 0
    for (let t = 0.01; t <= 1; t += 0.01) {
      const value = ease(t)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    // The click is answered: 100 ms into a 1400 ms flight the camera has
    // visibly started, by 200 ms it is well on its way.
    expect(ease(100 / 1400)).toBeGreaterThan(0.025)
    expect(ease(200 / 1400)).toBeGreaterThan(0.1)
  })
})

describe('snapshots', () => {
  it('keeps the hero star field at rest', () => {
    expect(at('hero').stars).toEqual({ x: 0, y: 0 })
  })

  it('moves stars by a fraction of the planet travel', () => {
    const hero = at('hero')
    const name = at('intake.name')
    expect(name.stars.x).toBeCloseTo((name.planet.x - hero.planet.x) * STAR_DEPTH, 6)
  })

  it('mixes continuously between the ends', () => {
    const a = at('hero')
    const b = at('intake.name')
    expect(mixSnapshots(a, b, 0)).toBe(a)
    expect(mixSnapshots(a, b, 1)).toBe(b)
    const mid = mixSnapshots(a, b, 0.5)
    expect(mid.planet.r).toBeCloseTo((a.planet.r + b.planet.r) / 2, 6)
    expect(mid.groundReveal).toBeCloseTo((a.groundReveal + b.groundReveal) / 2, 6)
  })
})

describe('SnapshotTween', () => {
  const transition = { duration: 1000, easing: easings.cinematic }

  it('snaps without a previous state or with zero duration', () => {
    const tween = new SnapshotTween()
    tween.retarget(at('intake.name'), transition, 0)
    expect(tween.active).toBe(false)
    tween.retarget(at('intake.date'), { ...transition, duration: 0 }, 0)
    expect(tween.current).toEqual(at('intake.date'))
  })

  it('flies to the target and ends exactly on it', () => {
    const tween = new SnapshotTween()
    tween.snap(at('hero'))
    tween.retarget(at('intake.name'), transition, 0)
    expect(tween.step(500)).toBe(true)
    expect(tween.step(1000)).toBe(false)
    expect(tween.current).toEqual(at('intake.name'))
  })

  it('retargets from where it is, without a jump', () => {
    const tween = new SnapshotTween()
    tween.snap(at('intake.name'))
    tween.retarget(at('intake.date'), transition, 0)
    tween.step(400)
    const midway = tween.current
    tween.retarget(at('intake.place'), transition, 400)
    expect(tween.current).toEqual(midway)
    tween.step(401)
    const next = tween.current
    expect(Math.abs((next?.planet.x ?? 0) - (midway?.planet.x ?? 0))).toBeLessThan(1)
  })

  it('keeps the speed of an interrupted flight instead of stalling', () => {
    const planetX = (tween: SnapshotTween) => tween.current?.planet.x ?? Number.NaN
    const tween = new SnapshotTween()
    tween.snap(at('intake.name'))
    tween.retarget(at('intake.date'), transition, 0)
    tween.step(284)
    const a = planetX(tween)
    tween.step(300)
    const b = planetX(tween)
    const speed = (b - a) / 16
    expect(Math.abs(speed)).toBeGreaterThan(0.01)

    tween.retarget(at('intake.place'), transition, 300)
    tween.step(316)
    const after = (planetX(tween) - b) / 16
    expect(after).toBeCloseTo(speed, 1)

    expect(tween.step(1300)).toBe(false)
    expect(tween.current).toEqual(at('intake.place'))
  })

  it('does not carry speed from a flight that has already ended', () => {
    const tween = new SnapshotTween()
    tween.snap(at('intake.name'))
    tween.retarget(at('intake.date'), transition, 0)
    tween.step(500)
    tween.step(1000)
    tween.retarget(at('intake.place'), transition, 1000)
    tween.step(1001)
    const start = at('intake.date').planet.x
    const travel = at('intake.place').planet.x - start
    expect(Math.abs((tween.current?.planet.x ?? 0) - start)).toBeLessThan(Math.abs(travel) * 0.01)
  })

  it('starts a scrolled page sky where the visitor saw it', () => {
    const tween = new SnapshotTween()
    tween.snap(at('hero'))
    tween.retarget(at('intake.name'), { ...transition, fromShiftY: -300 }, 0)
    expect(tween.current?.planet.y).toBeCloseTo(at('hero').planet.y - 300, 6)
  })
})
