import type { LocationQuery, RouteLocationNormalized, RouteLocationRaw, RouteMeta } from 'vue-router'

import type { CompositionName } from '@/scene/compositions'

import { firstIncomplete, reachableStep, useIntakeDraft } from './draft'
import { parseStep, REVIEW_RETURN, stepScene } from './steps'

export const INTAKE_ROUTE = 'create'
export const REVIEW_ROUTE = 'create-review'

/**
 * Keeps `/create?step=` honest (SCR-02 §0.6): no step means the saved one,
 * and a link can never open a question past the first unanswered one. A
 * correction replaces the history entry, so «Назад» does not bounce.
 *
 * The review (SCR-03 §0.3) opens only for a complete draft; otherwise the
 * first unanswered step opens in edit mode, so answering it returns here.
 */
export function guardIntake(to: RouteLocationNormalized): true | RouteLocationRaw {
  if (to.name === REVIEW_ROUTE) {
    const open = firstIncomplete(useIntakeDraft().draft)
    if (!open) return true
    return { name: INTAKE_ROUTE, query: { step: open, from: REVIEW_RETURN }, replace: true }
  }
  if (to.name !== INTAKE_ROUTE) return true
  const requested = parseStep(to.query.step)
  const step = reachableStep(useIntakeDraft().draft, requested)
  if (requested === step) return true
  return { name: INTAKE_ROUTE, query: { ...to.query, step }, hash: to.hash, replace: true }
}

/** The intake shows the frame of its current step; other routes declare theirs. */
export function sceneOf(route: { name?: unknown; query: LocationQuery; meta: RouteMeta }): CompositionName {
  if (route.name === INTAKE_ROUTE) return stepScene(parseStep(route.query.step) ?? 'name')
  return route.meta.scene
}
