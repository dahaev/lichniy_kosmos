import { durations, easings, seconds } from './tokens'

/**
 * Neutral route cross-fade used by S0 placeholder screens. Real screen
 * choreography (M01–M09) is designed per screen from slice V1 on.
 */
export const routeFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: seconds(durations.step), ease: easings.out } },
  exit: { opacity: 0, transition: { duration: seconds(durations.micro), ease: easings.out } },
} as const

/**
 * M02 (SCR-02 §2.2): the hero copy leaves as one layer while the camera
 * already moves, so the click is answered at once. Under reduced motion
 * Motion drops the transform and keeps the fade.
 */
export const heroExit = {
  opacity: 0,
  y: -8,
  filter: 'blur(2px)',
  transition: { duration: 0.28, ease: easings.out },
} as const

/**
 * Coming back to the hero (SCR-02 Ж11): M01 belongs to the first visit only.
 * The copy returns as one layer from the left, mirroring the intake leaving
 * to the right, while the camera flies home.
 */
export const heroReturn = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.5, ease: easings.out } },
} as const

/** Direction of an intake step change: 1 forward, −1 back. */
export type StepDirection = 1 | -1

/**
 * M03 (SCR-02 §2.3): the old step block leaves against the direction of
 * travel; the new one slides in from it (CSS, `intake-slide`). A variant
 * function: AnimatePresence passes the direction as `custom` at exit time.
 */
export const stepBlockExit = (direction: StepDirection) => ({
  opacity: 0,
  x: -20 * direction,
  filter: 'blur(2px)',
  transition: { duration: seconds(durations.stepExit), ease: easings.out },
})

/** The intake leaves as one quiet layer; the camera carries the move. */
export const intakeExit = {
  opacity: 0,
  x: 20,
  filter: 'blur(2px)',
  transition: { duration: seconds(durations.stepExit), ease: easings.out },
} as const
