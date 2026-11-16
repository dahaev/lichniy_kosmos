import type { components } from '@/api/schema'

type Schemas = components['schemas']

/**
 * Generation states of a mock order and the moves between them
 * (ARCHITECTURE_MVP_v2 §13.5–13.6, SCR-06 §0.0). The real status is computed
 * on the server from two steps; the mock keeps the computed result and only
 * the facts the client can see:
 *
 *   queued ─▶ writing ─▶ illustrating ─▶ ready
 *      │          │            │
 *      │          ├────────────┴─▶ failed_retryable   (a dead end here: no resume call, decision 12)
 *      └──────────┴────────────┴─▶ needs_review (paused | review) ─▶ back to queued / illustrating
 *
 * `calculated` is not reachable in slice 6 (generation off closes creation).
 */
export type OrderStatus = Schemas['OrderStatus']
export type StopReason = NonNullable<Schemas['Generation']['stop_reason']>

export type OrderState =
  | { status: 'queued' }
  | { status: 'writing' }
  | { status: 'illustrating' }
  | { status: 'ready' }
  /** `readingReady`: the text was accepted before the stop. */
  | { status: 'failed_retryable'; readingReady: boolean }
  | { status: 'needs_review'; stopReason: StopReason; readingReady: boolean }

export type OrderStateName = OrderState['status']

export const ORDER_STATE_NAMES = ['queued', 'writing', 'illustrating', 'ready', 'failed_retryable', 'needs_review'] as const satisfies readonly OrderStateName[]

/** A deliberate fake: it names no real case and is shown as a test value only. */
export const SUPPORT_REFERENCE_PREFIX = 'REV-TEST-'

export const states = {
  queued: { status: 'queued' },
  writing: { status: 'writing' },
  illustrating: { status: 'illustrating' },
  ready: { status: 'ready' },
  failed: (readingReady: boolean): OrderState => ({ status: 'failed_retryable', readingReady }),
  paused: (readingReady: boolean): OrderState => ({ status: 'needs_review', stopReason: 'paused', readingReady }),
  review: (readingReady: boolean): OrderState => ({ status: 'needs_review', stopReason: 'review', readingReady }),
} as const

export function isReadingReady(state: OrderState): boolean {
  switch (state.status) {
    case 'queued':
    case 'writing':
      return false
    case 'illustrating':
    case 'ready':
      return true
    case 'failed_retryable':
    case 'needs_review':
      return state.readingReady
  }
}

/** Generation stopped and will not go on by itself: the files that are missing will not appear. */
function isStopped(state: OrderState): boolean {
  return state.status === 'failed_retryable' || (state.status === 'needs_review' && state.stopReason === 'review')
}

/**
 * Can the server move an order from `from` to `to`? Mirrors §13.5: forward
 * along the happy path; a stop from any active state (a reading stop keeps
 * `readingReady = false`, an illustration stop keeps it `true`); the owner or
 * the lifted pause returns `needs_review` to the step that was waiting.
 * `ready` and `failed_retryable` have no way out in the mock.
 */
export function canTransition(from: OrderState, to: OrderState): boolean {
  const reading = isReadingReady(from)
  switch (from.status) {
    case 'queued':
      return to.status === 'writing' || (to.status === 'needs_review' && to.stopReason === 'paused' && !to.readingReady)
    case 'writing':
      return (
        to.status === 'illustrating' ||
        (to.status === 'failed_retryable' && !to.readingReady) ||
        (to.status === 'needs_review' && !to.readingReady)
      )
    case 'illustrating':
      return to.status === 'ready' || (to.status === 'failed_retryable' && to.readingReady) || (to.status === 'needs_review' && to.readingReady)
    case 'needs_review':
      return reading ? to.status === 'illustrating' : to.status === 'queued'
    case 'ready':
    case 'failed_retryable':
      return false
  }
}

/** The next state on the happy path, or null when the order is done or stopped. */
export function nextHappyState(state: OrderState): OrderState | null {
  switch (state.status) {
    case 'queued':
      return states.writing
    case 'writing':
      return states.illustrating
    case 'illustrating':
      return states.ready
    default:
      return null
  }
}

/** `Generation` as the client reads it. `supportReference` is used only for a review stop. */
export function generationOf(state: OrderState, supportReference: string): Schemas['Generation'] {
  const generation: Schemas['Generation'] = {
    reading_ready: isReadingReady(state),
    illustration_ready: state.status === 'ready',
    // Q14 is open and there is no resume call (decision 12): the server never offers it.
    can_resume: false,
  }
  if (state.status !== 'needs_review') return generation
  generation.stop_reason = state.stopReason
  if (state.stopReason === 'review') generation.support_reference = supportReference
  return generation
}

/** `pending` appears without the user; `unavailable` will not, while the generation is stopped. */
export function filesOf(state: OrderState): Schemas['OrderFiles'] {
  const missing: Schemas['FileAvailability'] = isStopped(state) ? 'unavailable' : 'pending'
  return {
    txt: isReadingReady(state) ? 'available' : missing,
    png: state.status === 'ready' ? 'available' : missing,
    pdf: state.status === 'ready' ? 'available' : missing,
  }
}

/** Dev switch values: `ready`, `needs_review:paused`, `failed_retryable:reading`, … */
export function parseState(value: string | null | undefined): OrderState | null {
  switch (value) {
    case 'queued':
    case 'writing':
    case 'illustrating':
    case 'ready':
      return states[value]
    case 'failed_retryable':
    case 'failed_retryable:reading':
      return states.failed(false)
    case 'failed_retryable:illustration':
      return states.failed(true)
    case 'needs_review:paused':
    case 'needs_review:paused:reading':
      return states.paused(false)
    case 'needs_review:paused:illustration':
      return states.paused(true)
    case 'needs_review:review':
    case 'needs_review:review:reading':
      return states.review(false)
    case 'needs_review:review:illustration':
      return states.review(true)
    default:
      return null
  }
}
