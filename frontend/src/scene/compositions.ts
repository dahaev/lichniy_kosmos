/**
 * Scene compositions from ARCHITECTURE_MVP_v2 §17.1. Their camera, planet,
 * orbit and horizon parameters (§17.2a) are calibrated against the reference
 * in slice V1; S0 only fixes the names so routes can request them.
 */
export const compositionNames = ['hero', 'intake', 'review', 'access', 'creation', 'result', 'quiet'] as const

export type CompositionName = (typeof compositionNames)[number]
