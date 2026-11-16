import type { components } from '@/api/schema'

import type { AccessMock } from './access'
import { chartFixture, type ChartFixtureName } from './chartFixtures'
import { canonical } from './orders'
import { canTransition, filesOf, generationOf, isReadingReady, states, SUPPORT_REFERENCE_PREFIX, type OrderState } from './orderStates'

type Schemas = components['schemas']

/**
 * Stand-in for `GET /api/v1/orders/{id}` and `GET /api/v1/orders/{id}/reading`
 * until the slice 6 backend (SCR-06 §0.4). It plays the server's side of
 * reading: who may read which order, the representation, `ETag`/`304`, the
 * rate limit, and the generation states of an order (`orderStates.ts`).
 *
 * Reading is a separate right from creating (SCR-06 decision 9): this file
 * never looks at `legal_ready`, `features.generation` or a blocked entitlement.
 *
 * The charts are synthetic fixtures (`chartFixtures.ts`), picked by the kind of
 * the order's time, not calculated from the profile.
 */

export const readDetails = {
  unauthenticated: 'Сессия закончилась. Введи код доступа ещё раз.',
  notFound: 'Разбор не найден.',
  readingNotReady: 'Текст разбора ещё не готов.',
  rateLimited: 'Слишком много запросов. Подожди немного.',
} as const

export type ReadScenario = 'rate-limited'

/** How often one session may read. Generous over the polling schedule (SCR-06 §0.4); the number is the stand's, not the server's. */
export interface ReadLimit {
  max: number
  windowMs: number
}

export const DEFAULT_READ_LIMIT: ReadLimit = { max: 120, windowMs: 60_000 }

export type ReadProblem = {
  status: 401 | 404 | 409 | 429
  code: Schemas['ErrorCode']
  detail: string
  retryAfter?: number
}

export type ReadOutcome<T> = { status: 200; body: T; etag: string } | { status: 304; etag: string } | ReadProblem

export interface ReadInput {
  id: string
  /** The `If-None-Match` header, or null when it is absent. */
  ifNoneMatch: string | null
  scenario?: ReadScenario | null
}

export interface RegisterInput {
  id: string
  entitlementId: string
  /** Null when the stand makes the order itself; the profile then follows the chart. */
  profile?: Schemas['Profile'] | null
  place?: Schemas['Place'] | null
  /** Default: `queued`. */
  state?: OrderState
  /** Default: picked by the kind of the order's time. */
  chart?: ChartFixtureName
}

interface OrderRecord {
  id: string
  entitlementId: string
  createdAt: string
  profile: Schemas['OrderProfile']
  chart: Schemas['Chart']
  state: OrderState
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 53-bit string hash (cyrb53): the mock's stand-in for the server's SHA-256 of the representation. */
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** A weak validator of the whole representation, status included. */
export function etagOf(representation: unknown): string {
  return `W/"${hash(canonical(representation))}"`
}

/** Weak comparison of `If-None-Match` with the current `ETag` (RFC 9110 §13.1.2); `*` matches any. */
export function etagMatches(header: string, etag: string): boolean {
  const bare = (tag: string): string => tag.trim().replace(/^W\//, '')
  if (header.trim() === '*') return true
  return header.split(',').some((tag) => bare(tag) === bare(etag))
}

/** Which synthetic chart an order gets, by the kind of its time; a fixture choice, not a rule of the product. */
export function fixtureForProfile(profile: Schemas['Profile']): ChartFixtureName {
  if (profile.time.kind === 'unknown') return 'unknown'
  return profile.time.accuracy_minutes > 0 ? 'range' : 'known'
}

function profileForChart(name: ChartFixtureName): Schemas['Profile'] {
  const base = { name: 'Тестовый заказ', birth_date: '2000-01-01', place_id: 'synthetic' }
  if (name === 'unknown') return { ...base, time: { kind: 'unknown' } }
  const accuracy = name === 'range' ? 60 : 0
  return { ...base, time: { kind: 'known', value: '12:00', source: 'approximate', accuracy_minutes: accuracy } }
}

const syntheticPlace: Schemas['Place'] = { id: 'synthetic', name: 'Тестовое место', country: 'Россия', latitude: 0, longitude: 0, timezone: 'Etc/UTC' }

function orderProfile(profile: Schemas['Profile'], place: Schemas['Place']): Schemas['OrderProfile'] {
  const time: Schemas['OrderBirthTime'] =
    profile.time.kind === 'known' ? { kind: 'known', value: profile.time.value, accuracy_minutes: profile.time.accuracy_minutes } : { kind: 'unknown' }
  return {
    name: profile.name,
    birth_date: profile.birth_date,
    place: { name: place.name, ...(place.region ? { region: place.region } : {}), country: place.country },
    time,
  }
}

/** A placeholder text. It says so itself: it is neither a reading nor an interpretation. */
function syntheticReading(): Schemas['Reading'] {
  const text = 'Это синтетический текст для проверки контракта. Он не является разбором и не описывает карту.'
  return {
    schema_version: 'synthetic-reading-v0',
    word_count: text.split(/\s+/).length * 2,
    sections: [
      { title: 'Синтетический раздел 1', text },
      { title: 'Синтетический раздел 2', text },
    ],
  }
}

export function createOrderReadsMock(access: AccessMock, options: { now?: () => number; limit?: ReadLimit } = {}) {
  const now = options.now ?? Date.now
  const limit = options.limit ?? DEFAULT_READ_LIMIT
  const records = new Map<string, OrderRecord>()
  let reads: Record<string, number[]> = {}

  const supportReference = (id: string): string => `${SUPPORT_REFERENCE_PREFIX}${id.slice(-4).toUpperCase()}`

  function view(record: OrderRecord): Schemas['Order'] {
    return {
      id: record.id,
      status: record.state.status,
      created_at: record.createdAt,
      profile: record.profile,
      chart: record.chart,
      generation: generationOf(record.state, supportReference(record.id)),
      files: filesOf(record.state),
    }
  }

  function problem(status: ReadProblem['status'], code: Schemas['ErrorCode'], detail: string, retryAfter?: number): ReadProblem {
    return retryAfter === undefined ? { status, code, detail } : { status, code, detail, retryAfter }
  }

  /** Seconds until one more read is allowed, or 0. Every read of a session counts, `304` included. */
  function throttled(sessionKey: string): number {
    const at = now()
    const recent = (reads[sessionKey] ?? []).filter((t) => at - t < limit.windowMs)
    if (recent.length >= limit.max) {
      reads[sessionKey] = recent
      return Math.max(1, Math.ceil(((recent[0] ?? at) + limit.windowMs - at) / 1000))
    }
    reads[sessionKey] = [...recent, at]
    return 0
  }

  /** The order, if this session may read it; otherwise the problem to answer with. */
  function authorize(input: ReadInput): OrderRecord | ReadProblem {
    if (input.scenario === 'rate-limited') return problem(429, 'rate_limited', readDetails.rateLimited, 30)
    const principal = access.readAccess()
    if (!principal) return problem(401, 'unauthenticated', readDetails.unauthenticated)
    const wait = throttled(principal.entitlementId)
    if (wait > 0) return problem(429, 'rate_limited', readDetails.rateLimited, wait)
    // «Not there», «someone else's» and «not a UUID» are one answer (ARCHITECTURE_MVP_v2 §9.5).
    const record = UUID.test(input.id) ? records.get(input.id.toLowerCase()) : undefined
    if (!record || record.entitlementId !== principal.entitlementId) return problem(404, 'not_found', readDetails.notFound)
    return record
  }

  function conditional<T>(input: ReadInput, body: T): ReadOutcome<T> {
    const etag = etagOf(body)
    if (input.ifNoneMatch !== null && etagMatches(input.ifNoneMatch, etag)) return { status: 304, etag }
    return { status: 200, body, etag }
  }

  return {
    /** An order enters the read side: at creation, or when the stand seeds one. */
    register(input: RegisterInput): void {
      const chartName = input.chart ?? (input.profile ? fixtureForProfile(input.profile) : 'known')
      const profile = input.profile ?? profileForChart(chartName)
      const chart = chartFixture(chartName)
      // The interval of a `range` chart follows the accuracy the user gave.
      if (chart.mode === 'range' && profile.time.kind === 'known') chart.time_basis.uncertainty_minutes = profile.time.accuracy_minutes || 60
      records.set(input.id.toLowerCase(), {
        id: input.id.toLowerCase(),
        entitlementId: input.entitlementId,
        createdAt: new Date(now()).toISOString(),
        profile: orderProfile(profile, input.place ?? syntheticPlace),
        chart,
        state: input.state ?? states.queued,
      })
    },

    /** `GET /api/v1/orders/{id}`. */
    read(input: ReadInput): ReadOutcome<Schemas['Order']> {
      const record = authorize(input)
      if (!('state' in record)) return record
      return conditional(input, view(record))
    },

    /** `GET /api/v1/orders/{id}/reading`. */
    readReading(input: ReadInput): ReadOutcome<Schemas['Reading']> {
      const record = authorize(input)
      if (!('state' in record)) return record
      if (!isReadingReady(record.state)) return problem(409, 'reading_not_ready', readDetails.readingNotReady)
      return conditional(input, syntheticReading())
    },

    /** The server moves the order along; false when the move is not one of the allowed ones. */
    advance(id: string, to: OrderState): boolean {
      const record = records.get(id.toLowerCase())
      if (!record || !canTransition(record.state, to)) return false
      record.state = to
      return true
    },

    /** The state the server holds now, for the stand and the tests. */
    stateOf(id: string): OrderState | null {
      return records.get(id.toLowerCase())?.state ?? null
    },

    has: (id: string): boolean => records.has(id.toLowerCase()),

    count: (): number => records.size,

    reset(): void {
      records.clear()
      reads = {}
    },
  }
}

export type OrderReadsMock = ReturnType<typeof createOrderReadsMock>
