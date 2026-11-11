import type { CubicBezier } from '@/motion/tokens'

import { addTravel, cubicBezier, mixSnapshots, shiftSnapshot, type SceneSnapshot } from './interpolate'

export interface SceneTransition {
  /** Milliseconds; 0 snaps. */
  duration: number
  easing: CubicBezier
  /**
   * Where the old scene really was on screen relative to its layout, e.g. a
   * page-owned sky carried up by scrolling. The flight starts from there.
   */
  fromShiftY?: number
}

/** Frames further apart than this say nothing about the current speed. */
const VELOCITY_WINDOW_MS = 100

/**
 * A camera move between two snapshots. Retargeting starts the new flight
 * from wherever the current one is and at the speed it had, so interrupted
 * moves neither jump nor stall: the old velocity decays along a Hermite
 * basis, h10(p) = p(1 − p)², which is gone by the end of the new flight.
 */
export class SnapshotTween {
  private from: SceneSnapshot | null = null
  private to: SceneSnapshot | null = null
  private start = 0
  private duration = 0
  private ease: (t: number) => number = (t) => t
  private value: SceneSnapshot | null = null
  /** Two last stepped states of the running flight: their difference over `velocityDt` is its velocity. */
  private previous: { value: SceneSnapshot; at: number } | null = null
  private latestAt = 0
  private carried: { a: SceneSnapshot; b: SceneSnapshot; dt: number } | null = null

  get current(): SceneSnapshot | null {
    return this.value
  }

  get active(): boolean {
    return this.to !== null
  }

  /** Jumps to `snapshot` and ends any flight. */
  snap(snapshot: SceneSnapshot): void {
    this.value = snapshot
    this.from = null
    this.to = null
    this.previous = null
    this.carried = null
  }

  /** Starts a flight from the current state; without one it snaps. */
  retarget(snapshot: SceneSnapshot, transition: SceneTransition, now: number): void {
    if (!this.value || transition.duration <= 0) {
      this.snap(snapshot)
      return
    }
    const moving = this.active && this.previous && now - this.latestAt < VELOCITY_WINDOW_MS ? this.previous : null
    const dt = moving ? this.latestAt - moving.at : 0
    this.carried = moving && dt > 0 && !transition.fromShiftY ? { a: moving.value, b: this.value, dt } : null
    this.from = transition.fromShiftY ? shiftSnapshot(this.value, transition.fromShiftY) : this.value
    this.to = snapshot
    this.start = now
    this.duration = transition.duration
    this.ease = cubicBezier(transition.easing)
    this.value = this.from
    this.previous = null
    this.latestAt = now
  }

  /** Advances to `now`; returns whether the flight is still running. */
  step(now: number): boolean {
    if (!this.from || !this.to) return false
    const progress = Math.min(Math.max((now - this.start) / this.duration, 0), 1)
    if (progress >= 1) {
      this.snap(this.to)
      return false
    }
    const before = this.value
    let value = mixSnapshots(this.from, this.to, this.ease(progress))
    if (this.carried) {
      const { a, b, dt } = this.carried
      value = addTravel(value, a, b, (this.duration / dt) * progress * (1 - progress) ** 2)
    }
    if (before && now > this.latestAt) this.previous = { value: before, at: this.latestAt }
    this.value = value
    this.latestAt = now
    return true
  }
}
