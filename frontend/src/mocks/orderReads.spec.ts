import { describe, expect, it } from 'vitest'

import type { components } from '@/api/schema'
import { check, schema } from '@/test/openapi'

import { createAccessMock, SESSION_TTL_MS, syntheticCodes, type AccessMock } from './access'
import { CHART_FIXTURE_NAMES } from './chartFixtures'
import { createOrderReadsMock, etagMatches, etagOf, type OrderReadsMock, type ReadOutcome } from './orderReads'
import { states, type OrderState } from './orderStates'
import { createOrdersMock, type CreationGate, type OrdersMock } from './orders'
import { TEST_CONSENT_VERSION } from './fixtures'

type Schemas = components['schemas']

const open: CreationGate = { legalReady: true, generation: true }
const profile: Schemas['Profile'] = {
  name: 'Анна',
  birth_date: '1990-03-12',
  place_id: 'ru-kzn',
  time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 },
}

const absent = null
const key = (n: number): string => `order-key-${String(n).padStart(10, '0')}`

interface Stand {
  access: AccessMock
  orders: OrdersMock
  reads: OrderReadsMock
  gate: CreationGate
  clock: { at: number }
  entitlementId: string
  /** Creates the order of the logged-in session through the order mock. */
  create: (overrides?: Partial<Schemas['Profile']>) => string
  /** One more order of the same session, put straight into the read side (one entitlement creates one order only). */
  add: (n: number, state?: OrderState) => string
}

/** A session on a free entitlement; an order is created through `POST` so that both mocks are wired the way the page wires them. */
function stand(options: { limit?: { max: number; windowMs: number } } = {}): Stand {
  const clock = { at: Date.UTC(2026, 10, 16, 9, 0, 0) }
  const gate: CreationGate = { ...open }
  const access = createAccessMock(() => clock.at)
  const reads = createOrderReadsMock(access, { now: () => clock.at, ...(options.limit ? { limit: options.limit } : {}) })
  const orders = createOrdersMock(access, () => gate, {
    created: ({ id, entitlementId, profile: created, place }) => {
      reads.register({ id, entitlementId, profile: created, place })
    },
  })
  access.login({ code: syntheticCodes.available })
  const entitlement = access.sessionEntitlement()
  if (!entitlement) throw new Error('the stand has no session')
  let sequence = 0
  return {
    access,
    orders,
    reads,
    gate,
    clock,
    entitlementId: entitlement.id,
    add(n, state = states.queued) {
      const id = `00000000-0000-4000-8000-0000000e4${String(n).padStart(3, '0')}`
      reads.register({ id, entitlementId: entitlement.id, state })
      return id
    },
    create(overrides = {}) {
      sequence += 1
      const outcome = orders.create({
        key: key(sequence),
        body: { entitlement_id: entitlement.id, profile: { ...profile, ...overrides }, consent_version: TEST_CONSENT_VERSION },
      })
      if (!('body' in outcome)) throw new Error(`the order was not created: ${String(outcome.status)} ${outcome.code}`)
      return outcome.body.id
    },
  }
}

const get = (reads: OrderReadsMock, id: string, ifNoneMatch: string | null = absent) => reads.read({ id, ifNoneMatch })

function ok<T>(outcome: ReadOutcome<T>): { body: T; etag: string } {
  if (outcome.status !== 200) throw new Error(`expected 200, got ${String(outcome.status)}`)
  return outcome
}

describe('who may read', () => {
  it('lets the session read the order its entitlement created', () => {
    const { reads, create } = stand()
    const id = create()

    expect(get(reads, id).status).toBe(200)
  })

  it('answers 401 without a session', () => {
    const { reads, access, create } = stand()
    const id = create()
    access.reset()

    expect(get(reads, id)).toMatchObject({ status: 401, code: 'unauthenticated' })
  })

  it('answers 401 when the session has expired', () => {
    const { reads, clock, create } = stand()
    const id = create()
    clock.at += SESSION_TTL_MS + 1

    expect(get(reads, id)).toMatchObject({ status: 401, code: 'unauthenticated' })
  })

  it('answers 401 when the code is bound to an account during generation (§9.2)', () => {
    const { reads, access, entitlementId, create } = stand()
    const id = create()
    expect(get(reads, id).status).toBe(200)

    access.bindToAccount(entitlementId)

    expect(get(reads, id)).toMatchObject({ status: 401, code: 'unauthenticated' })
  })

  it('answers 404 for a missing order, for another entitlement’s order and for an id that is no UUID — in the same words', () => {
    const { reads, access, create } = stand()
    const mine = create()
    // Another entitlement logs in on this browser and creates an order of its own.
    access.login({ code: syntheticCodes.availableOther, replace_session: true })
    const other = access.sessionEntitlement()
    if (!other) throw new Error('no second session')
    reads.register({ id: '00000000-0000-4000-8000-0000000e0aaa', entitlementId: other.id })

    const missing = get(reads, '00000000-0000-4000-8000-0000000e0bbb')
    const foreign = get(reads, mine)
    const notUuid = get(reads, 'not-a-uuid')

    expect([missing, foreign, notUuid]).toEqual([
      { status: 404, code: 'not_found', detail: expect.any(String) },
      { status: 404, code: 'not_found', detail: expect.any(String) },
      { status: 404, code: 'not_found', detail: expect.any(String) },
    ])
    expect(new Set([missing, foreign, notUuid].map((outcome) => JSON.stringify(outcome))).size).toBe(1)
  })

  it('reads an order id written in capitals', () => {
    const { reads, create } = stand()
    const id = create()

    expect(get(reads, id.toUpperCase()).status).toBe(200)
  })
})

describe('reading is a right apart from creating (decision 9)', () => {
  it('reads after the creation gate is closed', () => {
    const { reads, gate, create } = stand()
    const id = create()

    gate.legalReady = false
    gate.generation = false

    expect(get(reads, id).status).toBe(200)
  })

  it('reads a finished order after the code is blocked for new paid steps', () => {
    const { reads, access, entitlementId, create } = stand()
    const id = create()
    reads.advance(id, states.writing)
    reads.advance(id, states.illustrating)
    reads.advance(id, states.ready)

    access.block(entitlementId)

    // The session no longer shows as a code session, yet the finished order still opens (Q9, SCR-06 В-10).
    expect(access.sessionEntitlement()).toBeNull()
    const outcome = ok(get(reads, id))
    expect(outcome.body.status).toBe('ready')
    expect(reads.readReading({ id, ifNoneMatch: absent }).status).toBe(200)
  })

  it('does not let the read right create anything', () => {
    const { reads, orders, create } = stand()
    const id = create()
    const before = orders.orderCount()

    for (let i = 0; i < 5; i++) get(reads, id)

    expect(orders.orderCount()).toBe(before)
    expect(reads.count()).toBe(1)
  })
})

describe('the order representation', () => {
  it('has the contract’s shape and nothing else, with no reading text and no private details', () => {
    const { reads, create } = stand()
    const { body } = ok(get(reads, create()))

    expect(check(schema('Order'), body)).toEqual([])
    expect(Object.keys(body).sort()).toEqual(['chart', 'created_at', 'files', 'generation', 'id', 'profile', 'status'])
    expect(body).not.toHaveProperty('reading')
    expect(Object.keys(body.profile.place).sort()).toEqual(['country', 'name', 'region'])
    // The place and the time of birth carry no coordinates, time zone, place id or source of the time.
    expect(JSON.stringify(body.profile)).not.toMatch(/latitude|longitude|timezone|place_id|source/)
    expect(JSON.stringify(body)).not.toMatch(/LK-|Idempotency/)
  })

  it('shows the minimal profile as the user gave it', () => {
    const { reads, create } = stand()
    const { body } = ok(get(reads, create()))

    expect(body.profile).toEqual({
      name: 'Анна',
      birth_date: '1990-03-12',
      place: { name: 'Казань', region: 'Республика Татарстан', country: 'Россия' },
      time: { kind: 'known', value: '14:30', accuracy_minutes: 0 },
    })
  })

  it('starts queued, with nothing ready, nothing to resume and no stop reason', () => {
    const { reads, create } = stand()
    const { body } = ok(get(reads, create()))

    expect(body.status).toBe('queued')
    expect(body.generation).toEqual({ reading_ready: false, illustration_ready: false, can_resume: false })
    expect(body.files).toEqual({ txt: 'pending', png: 'pending', pdf: 'pending' })
  })

  it('is the same on every read of an unchanged order, created_at included', () => {
    const { reads, clock, create } = stand()
    const id = create()
    const first = ok(get(reads, id))
    clock.at += 60_000

    expect(ok(get(reads, id))).toEqual(first)
  })

  it.each(CHART_FIXTURE_NAMES)('serves the "%s" chart through the contract’s Order schema in every state', (name) => {
    const { reads, entitlementId } = stand()
    const everyState: OrderState[] = [
      states.queued,
      states.writing,
      states.illustrating,
      states.ready,
      states.failed(false),
      states.failed(true),
      states.paused(false),
      states.paused(true),
      states.review(false),
      states.review(true),
    ]

    everyState.forEach((state, index) => {
      const id = `00000000-0000-4000-8000-0000000e1${String(index).padStart(3, '0')}`
      reads.register({ id, entitlementId, chart: name, state })
      const { body } = ok(get(reads, id))

      expect(check(schema('Order'), body), `${name} ${state.status}`).toEqual([])
      expect(body.status).toBe(state.status)
      expect(body.chart.mode).toBe(name === 'range' ? 'range' : name === 'unknown' ? 'unknown' : 'known')
    })
  })
})

describe('the chart follows the kind of time', () => {
  it.each([
    ['exact time', { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 }, 'known', undefined],
    ['time with a ±15 min error', { kind: 'known', value: '14:30', source: 'family', accuracy_minutes: 15 }, 'range', 15],
    ['time with a ±60 min error', { kind: 'known', value: '14:30', source: 'approximate', accuracy_minutes: 60 }, 'range', 60],
    ['unknown time', { kind: 'unknown' }, 'unknown', undefined],
  ] as const)('%s → %s chart', (_name, time, mode, uncertainty) => {
    const { reads, create } = stand()
    const { body } = ok(get(reads, create({ time })))

    expect(body.chart.mode).toBe(mode)
    expect(body.chart.time_basis.uncertainty_minutes).toBe(uncertainty)
    expect(body.profile.time.kind).toBe(time.kind)
    expect(body.chart.version).toMatch(/^synthetic-/)
    expect(check(schema('Order'), body)).toEqual([])
  })

  it('shows a range order its own accuracy, not the fixture’s', () => {
    const { reads, create } = stand()
    const { body } = ok(get(reads, create({ time: { kind: 'known', value: '09:00', source: 'family', accuracy_minutes: 30 } })))

    expect(body.chart.time_basis).toEqual({ reference_moment: 'interval_midpoint', uncertainty_minutes: 30 })
    expect(body.profile.time).toEqual({ kind: 'known', value: '09:00', accuracy_minutes: 30 })
  })
})

describe('moving an order along', () => {
  it('follows the allowed moves and refuses the others without changing the order', () => {
    const { reads, create } = stand()
    const id = create()

    expect(reads.advance(id, states.ready)).toBe(false)
    expect(reads.stateOf(id)).toEqual(states.queued)
    expect(reads.advance(id, states.writing)).toBe(true)
    expect(reads.advance(id, states.illustrating)).toBe(true)
    expect(reads.advance(id, states.ready)).toBe(true)
    expect(reads.advance(id, states.writing)).toBe(false)
    expect(ok(get(reads, id)).body.status).toBe('ready')
  })

  it('says what the stop is: paused and review differ, and only review has a support reference', () => {
    const { reads, add } = stand()
    const paused = add(1, states.writing)
    const review = add(2, states.writing)
    reads.advance(paused, states.paused(false))
    reads.advance(review, states.review(false))
    const { body: pausedBody } = ok(get(reads, paused))
    const { body: reviewBody } = ok(get(reads, review))

    expect(pausedBody.status).toBe('needs_review')
    expect(pausedBody.generation.stop_reason).toBe('paused')
    expect(pausedBody.generation).not.toHaveProperty('support_reference')
    expect(pausedBody.files).toEqual({ txt: 'pending', png: 'pending', pdf: 'pending' })

    expect(reviewBody.status).toBe('needs_review')
    expect(reviewBody.generation.stop_reason).toBe('review')
    expect(reviewBody.generation.support_reference).toMatch(/^REV-TEST-/)
    expect(reviewBody.files).toEqual({ txt: 'unavailable', png: 'unavailable', pdf: 'unavailable' })
  })

  it('lets a lifted pause go back to the waiting step', () => {
    const { reads, create } = stand()
    const id = create()
    reads.advance(id, states.writing)
    reads.advance(id, states.illustrating)
    reads.advance(id, states.paused(true))

    expect(ok(get(reads, id)).body.generation).toEqual({ reading_ready: true, illustration_ready: false, can_resume: false, stop_reason: 'paused' })
    expect(reads.advance(id, states.queued)).toBe(false)
    expect(reads.advance(id, states.illustrating)).toBe(true)
    expect(ok(get(reads, id)).body.generation).not.toHaveProperty('stop_reason')
  })

  it('leaves failed_retryable where it is: nobody resumes it yet', () => {
    const { reads, create } = stand()
    const id = create()
    reads.advance(id, states.writing)
    reads.advance(id, states.failed(false))

    for (const next of [states.queued, states.writing, states.illustrating, states.ready]) expect(reads.advance(id, next)).toBe(false)
    const { body } = ok(get(reads, id))
    expect(body.status).toBe('failed_retryable')
    expect(body.generation.can_resume).toBe(false)
    expect(body.generation).not.toHaveProperty('stop_reason')
  })
})

describe('ETag and 304', () => {
  it('sends a weak ETag and answers 304 to the same one, without a body', () => {
    const { reads, create } = stand()
    const id = create()

    const first = ok(get(reads, id))
    const again = get(reads, id, first.etag)

    expect(first.etag).toMatch(/^W\/"[0-9a-f]+"$/)
    expect(again).toEqual({ status: 304, etag: first.etag })
    expect(again).not.toHaveProperty('body')
  })

  it('changes the ETag when the status changes, though nothing was written to the order', () => {
    const { reads, create } = stand()
    const id = create()
    const queued = ok(get(reads, id))

    reads.advance(id, states.paused(false))
    const paused = get(reads, id, queued.etag)

    expect(paused.status).toBe(200)
    expect(ok(paused).etag).not.toBe(queued.etag)
  })

  it('changes the ETag when only the stop reason changes', () => {
    const { reads, add } = stand()
    const a = add(1, states.writing)
    const b = add(2, states.writing)
    reads.advance(a, states.paused(false))
    reads.advance(b, states.review(false))

    expect(ok(get(reads, a)).etag).not.toBe(ok(get(reads, b)).etag)
  })

  it('gives each order its own ETag', () => {
    const { reads, add } = stand()

    expect(ok(get(reads, add(1))).etag).not.toBe(ok(get(reads, add(2))).etag)
  })

  it('walks the whole happy path with a fresh ETag at every step and 304 in between', () => {
    const { reads, create } = stand()
    const id = create()
    const seen = new Set<string>()
    let etag = ok(get(reads, id)).etag
    seen.add(etag)

    for (const next of [states.writing, states.illustrating, states.ready]) {
      expect(get(reads, id, etag).status).toBe(304)
      reads.advance(id, next)
      const outcome = get(reads, id, etag)
      expect(outcome.status).toBe(200)
      etag = ok(outcome).etag
      seen.add(etag)
    }
    expect(seen.size).toBe(4)
    expect(get(reads, id, etag).status).toBe(304)
  })

  it.each([
    ['the strong form of the same tag', (etag: string) => etag.replace(/^W\//, ''), 304],
    ['a list that contains it', (etag: string) => `W/"0000000000000a", ${etag}`, 304],
    ['a star', () => '*', 304],
    ['another tag', () => 'W/"0000000000000a"', 200],
    ['garbage', () => 'garbage', 200],
    ['an empty header', () => '', 200],
  ])('treats %s in If-None-Match', (_name, header, status) => {
    const { reads, create } = stand()
    const id = create()
    const { etag } = ok(get(reads, id))

    expect(get(reads, id, header(etag)).status).toBe(status)
  })

  it('answers 401 and 404 before looking at If-None-Match', () => {
    const { reads, access, create } = stand()
    const id = create()
    const { etag } = ok(get(reads, id))

    expect(get(reads, '00000000-0000-4000-8000-0000000e0bbb', etag).status).toBe(404)
    access.reset()
    expect(get(reads, id, etag).status).toBe(401)
  })

  it('compares tags the way HTTP does', () => {
    expect(etagMatches('W/"a"', 'W/"a"')).toBe(true)
    expect(etagMatches('"a"', 'W/"a"')).toBe(true)
    expect(etagMatches('"a", "b"', 'W/"b"')).toBe(true)
    expect(etagMatches('W/"a"', 'W/"b"')).toBe(false)
    expect(etagOf({ a: 1, b: 2 })).toBe(etagOf({ b: 2, a: 1 }))
    expect(etagOf({ a: 1 })).not.toBe(etagOf({ a: 2 }))
  })
})

describe('rate limit', () => {
  it('answers 429 with Retry-After once the session reads too often, 304 included', () => {
    const { reads, create } = stand({ limit: { max: 3, windowMs: 10_000 } })
    const id = create()
    const { etag } = ok(get(reads, id))

    expect(get(reads, id, etag).status).toBe(304)
    expect(get(reads, id, etag).status).toBe(304)
    expect(get(reads, id, etag)).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 10 })
  })

  it('lets the session read again when the window has passed, and counts down the wait', () => {
    const { reads, clock, create } = stand({ limit: { max: 2, windowMs: 10_000 } })
    const id = create()
    get(reads, id)
    get(reads, id)
    clock.at += 4_000

    expect(get(reads, id)).toMatchObject({ status: 429, retryAfter: 6 })
    clock.at += 6_000
    expect(get(reads, id).status).toBe(200)
  })

  it('does not count a read that was refused for the session', () => {
    const { reads, access, create } = stand({ limit: { max: 1, windowMs: 10_000 } })
    const id = create()
    access.reset()
    for (let i = 0; i < 4; i++) expect(get(reads, id).status).toBe(401)
  })

  it('answers the forced scenario whatever the session', () => {
    const { reads, create } = stand()
    const id = create()

    expect(reads.read({ id, ifNoneMatch: absent, scenario: 'rate-limited' })).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 30 })
  })

  it('keeps the default limit well above the polling schedule', () => {
    const { reads, create } = stand()
    const id = create()

    // One request every 2 s for a minute is 30 reads (SCR-06 §0.4).
    for (let i = 0; i < 30; i++) expect(get(reads, id).status).toBe(200)
  })
})

describe('the reading as its own resource', () => {
  it.each([
    [states.queued, 409],
    [states.writing, 409],
    [states.illustrating, 200],
    [states.ready, 200],
    [states.failed(false), 409],
    [states.failed(true), 200],
    [states.paused(false), 409],
    [states.paused(true), 200],
    [states.review(false), 409],
    [states.review(true), 200],
  ] as const)('is %j → %i', (state, status) => {
    const { reads, entitlementId } = stand()
    const id = '00000000-0000-4000-8000-0000000e3001'
    reads.register({ id, entitlementId, state })

    const outcome = reads.readReading({ id, ifNoneMatch: absent })

    expect(outcome.status).toBe(status)
    if (outcome.status === 409) expect(outcome).toMatchObject({ code: 'reading_not_ready' })
    if (outcome.status === 200) expect(check(schema('Reading'), outcome.body)).toEqual([])
  })

  it('opens exactly when the order says reading_ready', () => {
    const { reads, create } = stand()
    const id = create()

    for (const next of [states.writing, states.illustrating, states.ready]) {
      reads.advance(id, next)
      const ready = ok(get(reads, id)).body.generation.reading_ready
      expect(reads.readReading({ id, ifNoneMatch: absent }).status === 200).toBe(ready)
    }
  })

  it('has its own ETag and answers 304', () => {
    const { reads, entitlementId } = stand()
    const id = '00000000-0000-4000-8000-0000000e3002'
    reads.register({ id, entitlementId, state: states.ready })

    const text = reads.readReading({ id, ifNoneMatch: absent })
    if (text.status !== 200) throw new Error('no text')

    expect(text.etag).not.toBe(ok(get(reads, id)).etag)
    expect(reads.readReading({ id, ifNoneMatch: text.etag })).toEqual({ status: 304, etag: text.etag })
  })

  it('does not change when the order moves on after the text was accepted', () => {
    const { reads, entitlementId } = stand()
    const id = '00000000-0000-4000-8000-0000000e3003'
    reads.register({ id, entitlementId, state: states.illustrating })
    const before = reads.readReading({ id, ifNoneMatch: absent })
    reads.advance(id, states.ready)

    expect(reads.readReading({ id, ifNoneMatch: absent })).toEqual(before)
  })

  it('checks access like the order: 401, then 404', () => {
    const { reads, access, entitlementId } = stand()
    const id = '00000000-0000-4000-8000-0000000e3004'
    reads.register({ id, entitlementId, state: states.ready })

    expect(reads.readReading({ id: 'nope', ifNoneMatch: absent })).toMatchObject({ status: 404, code: 'not_found' })
    access.reset()
    expect(reads.readReading({ id, ifNoneMatch: absent })).toMatchObject({ status: 401, code: 'unauthenticated' })
  })

  it('is labelled as a placeholder', () => {
    const { reads, entitlementId } = stand()
    const id = '00000000-0000-4000-8000-0000000e3005'
    reads.register({ id, entitlementId, state: states.ready })
    const text = reads.readReading({ id, ifNoneMatch: absent })
    if (text.status !== 200) throw new Error('no text')

    expect(text.body.schema_version).toMatch(/^synthetic-/)
    expect(text.body.sections.every((section) => section.text.includes('синтетический'))).toBe(true)
  })
})
