import type { CompositionName } from '@/scene/compositions'

/** SCR-02: the four questions in order; slugs are the `?step=` values (decision 21). */
export const intakeSteps = ['name', 'date', 'place', 'time'] as const

export type IntakeStep = (typeof intakeSteps)[number]

export function parseStep(value: unknown): IntakeStep | null {
  return typeof value === 'string' && (intakeSteps as readonly string[]).includes(value) ? (value as IntakeStep) : null
}

export function stepIndex(step: IntakeStep): number {
  return intakeSteps.indexOf(step)
}

export function nextStep(step: IntakeStep): IntakeStep | null {
  return intakeSteps[stepIndex(step) + 1] ?? null
}

export function previousStep(step: IntakeStep): IntakeStep | null {
  return intakeSteps[stepIndex(step) - 1] ?? null
}

export function earlierStep(a: IntakeStep, b: IntakeStep): IntakeStep {
  return stepIndex(a) <= stepIndex(b) ? a : b
}

/**
 * «Изменить» on the review opens a step with `?from=review` (SCR-03 C-R3):
 * confirming the answer goes straight back to the review. The flag names
 * where to return, never what was entered.
 */
export const REVIEW_RETURN = 'review'

export function isReviewEdit(query: Record<string, unknown>): boolean {
  return query.from === REVIEW_RETURN
}

/** Each step is its own frame of the scene (SCR-02 §0.2). */
export function stepScene(step: IntakeStep): CompositionName {
  return `intake.${step}`
}
