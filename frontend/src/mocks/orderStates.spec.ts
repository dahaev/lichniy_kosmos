import { describe, expect, it } from 'vitest'

import { check, schema } from '@/test/openapi'

import {
  canTransition,
  filesOf,
  generationOf,
  isReadingReady,
  nextHappyState,
  ORDER_STATE_NAMES,
  parseState,
  states,
  SUPPORT_REFERENCE_PREFIX,
  type OrderState,
} from './orderStates'

/** One representative of every state the client can meet; the label is only for the table below. */
const all = {
  queued: states.queued,
  writing: states.writing,
  illustrating: states.illustrating,
  ready: states.ready,
  failedReading: states.failed(false),
  failedIllustration: states.failed(true),
  pausedReading: states.paused(false),
  pausedIllustration: states.paused(true),
  reviewReading: states.review(false),
  reviewIllustration: states.review(true),
} satisfies Record<string, OrderState>

type Label = keyof typeof all

/** Every allowed move, written out. Anything not here is refused. */
const allowed: Record<Label, Label[]> = {
  queued: ['writing', 'pausedReading'],
  writing: ['illustrating', 'failedReading', 'pausedReading', 'reviewReading'],
  illustrating: ['ready', 'failedIllustration', 'pausedIllustration', 'reviewIllustration'],
  ready: [],
  failedReading: [],
  failedIllustration: [],
  // A lifted pause or a requeue by the owner returns to the step that was waiting.
  pausedReading: ['queued'],
  pausedIllustration: ['illustrating'],
  reviewReading: ['queued'],
  reviewIllustration: ['illustrating'],
}

const labels = Object.keys(all) as Label[]

describe('state transitions', () => {
  it.each(labels.flatMap((from) => labels.map((to) => [from, to] as const)))('%s → %s', (from, to) => {
    expect(canTransition(all[from], all[to])).toBe(allowed[from].includes(to))
  })

  it('walks the happy path queued → writing → illustrating → ready', () => {
    const path: string[] = []
    for (let state: OrderState | null = states.queued; state; state = nextHappyState(state)) path.push(state.status)

    expect(path).toEqual(['queued', 'writing', 'illustrating', 'ready'])
  })

  it('has no way out of ready', () => {
    for (const label of labels) expect(canTransition(states.ready, all[label])).toBe(false)
  })

  it('has no way out of failed_retryable: there is no resume call yet (decision 12)', () => {
    for (const label of labels) {
      expect(canTransition(states.failed(false), all[label])).toBe(false)
      expect(canTransition(states.failed(true), all[label])).toBe(false)
    }
    expect(nextHappyState(states.failed(true))).toBeNull()
  })

  it('never reaches calculated: it is not a state of the mock', () => {
    expect(ORDER_STATE_NAMES).not.toContain('calculated')
  })

  it('does not move a paused or review order along the happy path by itself', () => {
    expect(nextHappyState(states.paused(false))).toBeNull()
    expect(nextHappyState(states.review(true))).toBeNull()
  })
})

describe('what the client sees of a state', () => {
  const generation = (label: Label) => generationOf(all[label], 'REV-TEST-0001')

  it.each([
    ['queued', false, false],
    ['writing', false, false],
    ['illustrating', true, false],
    ['ready', true, true],
    ['failedReading', false, false],
    ['failedIllustration', true, false],
    ['pausedReading', false, false],
    ['pausedIllustration', true, false],
    ['reviewReading', false, false],
    ['reviewIllustration', true, false],
  ] as const)('%s: reading_ready=%s, illustration_ready=%s', (label, reading, illustration) => {
    expect(generation(label)).toMatchObject({ reading_ready: reading, illustration_ready: illustration })
    expect(isReadingReady(all[label])).toBe(reading)
  })

  it('offers no resume in any state while Q14 is open', () => {
    for (const label of labels) expect(generation(label).can_resume, label).toBe(false)
  })

  it('gives stop_reason only to needs_review, and only paused or review', () => {
    for (const label of labels) {
      const state = all[label]
      const { stop_reason: reason } = generation(label)
      if (state.status === 'needs_review') expect(['paused', 'review']).toContain(reason)
      else expect(reason, label).toBeUndefined()
    }
    expect(generation('pausedReading').stop_reason).toBe('paused')
    expect(generation('reviewReading').stop_reason).toBe('review')
  })

  it('gives a support reference only to a review stop', () => {
    for (const label of labels) {
      const { support_reference: reference } = generation(label)
      if (label.startsWith('review')) expect(reference).toMatch(new RegExp(`^${SUPPORT_REFERENCE_PREFIX}`))
      else expect(reference, label).toBeUndefined()
    }
  })

  it('marks every support reference as a test value', () => {
    expect(SUPPORT_REFERENCE_PREFIX).toMatch(/TEST/)
  })

  it.each([
    ['queued', 'pending', 'pending', 'pending'],
    ['writing', 'pending', 'pending', 'pending'],
    ['illustrating', 'available', 'pending', 'pending'],
    ['ready', 'available', 'available', 'available'],
    ['failedReading', 'unavailable', 'unavailable', 'unavailable'],
    ['failedIllustration', 'available', 'unavailable', 'unavailable'],
    ['pausedReading', 'pending', 'pending', 'pending'],
    ['pausedIllustration', 'available', 'pending', 'pending'],
    ['reviewReading', 'unavailable', 'unavailable', 'unavailable'],
    ['reviewIllustration', 'available', 'unavailable', 'unavailable'],
  ] as const)('%s: files txt=%s png=%s pdf=%s', (label, txt, png, pdf) => {
    expect(filesOf(all[label])).toEqual({ txt, png, pdf })
  })

  it('keeps a finished text readable and downloadable whatever happens to the illustration', () => {
    for (const label of ['illustrating', 'failedIllustration', 'pausedIllustration', 'reviewIllustration', 'ready'] as const) {
      expect(filesOf(all[label]).txt, label).toBe('available')
    }
  })

  it('produces a Generation and OrderFiles the contract accepts, in every state', () => {
    for (const label of labels) {
      expect(check(schema('Generation'), generation(label)), label).toEqual([])
      expect(check(schema('OrderFiles'), filesOf(all[label])), label).toEqual([])
    }
  })
})

describe('dev state names', () => {
  it.each([
    ['queued', states.queued],
    ['writing', states.writing],
    ['illustrating', states.illustrating],
    ['ready', states.ready],
    ['failed_retryable', states.failed(false)],
    ['failed_retryable:illustration', states.failed(true)],
    ['needs_review:paused', states.paused(false)],
    ['needs_review:paused:illustration', states.paused(true)],
    ['needs_review:review', states.review(false)],
    ['needs_review:review:illustration', states.review(true)],
  ])('"%s" is read as the state it names', (value, expected) => {
    expect(parseState(value)).toEqual(expected)
  })

  it.each([null, undefined, '', 'calculated', 'needs_review', 'needs_review:stopped', 'done'])('refuses %j', (value) => {
    expect(parseState(value)).toBeNull()
  })
})
