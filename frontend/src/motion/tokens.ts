/**
 * Motion tokens shared by Motion for Vue (DOM) and SceneDirector (WebGL), so
 * both layers move with the same timing (ARCHITECTURE_MVP_v2 §17.1).
 * Mirrors the motion block of src/ui/tokens.css.
 */

export type CubicBezier = readonly [number, number, number, number]

/** Durations in milliseconds, MOTION_SPEC §3 starting values. */
export const durations = {
  micro: 160,
  step: 400,
  route: 700,
  camera: 1200,
  reveal: 2400,
  /** Camera between the hero and the intake (SCR-02 §2.1). */
  cameraRoute: 1400,
  /** Camera between two intake steps. */
  cameraStep: 1000,
  /** A step block entering, and leaving faster than it enters. */
  stepEnter: 420,
  stepExit: 200,
} as const

/** Delay between lines entering together. */
export const stagger = 45

export const easings = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  /**
   * Camera: moves off at once after the click and settles long and soft. The
   * strong inOut barely moves for the first ≈200 ms of a 1.4 s flight, which
   * reads as a click that was not heard.
   */
  cinematic: [0.3, 0.05, 0.1, 1],
} as const satisfies Record<string, CubicBezier>

/** Motion for Vue expects seconds. */
export function seconds(ms: number): number {
  return ms / 1000
}
