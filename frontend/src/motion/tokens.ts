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
} as const

export const easings = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
} as const satisfies Record<string, CubicBezier>

/** Motion for Vue expects seconds. */
export function seconds(ms: number): number {
  return ms / 1000
}
