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
