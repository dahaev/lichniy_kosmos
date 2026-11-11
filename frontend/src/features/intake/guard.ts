import type { LocationQuery, RouteLocationNormalized, RouteLocationRaw, RouteMeta } from 'vue-router'

import type { CompositionName } from '@/scene/compositions'

import { reachableStep, useIntakeDraft } from './draft'
import { parseStep, stepScene } from './steps'

export const INTAKE_ROUTE = 'create'

/**
 * Keeps `/create?step=` honest (SCR-02 §0.6): no step means the saved one,
 * and a link can never open a question past the first unanswered one. A
 * correction replaces the history entry, so «Назад» does not bounce.
 */
export function guardIntake(to: RouteLocationNormalized): true | RouteLocationRaw {
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
