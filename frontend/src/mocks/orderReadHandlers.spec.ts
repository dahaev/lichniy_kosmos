import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from '@/api/client'
import type { components } from '@/api/schema'
import { check, declaredStatuses, requiredHeaders, responseBody, schema } from '@/test/openapi'

import { syntheticCodes } from './access'
import { TEST_CONSENT_VERSION } from './fixtures'
import { accessMock, orderReadsMock, ordersMock } from './handlers'
import { states, type OrderState } from './orderStates'

type Schemas = components['schemas']

const ORDER_PATH = '/api/v1/orders/{id}'
const READING_PATH = '/api/v1/orders/{id}/reading'
const ID = '00000000-0000-4000-8000-0000000f0001'
const OTHER_ID = '00000000-0000-4000-8000-0000000f0002'

let client: ReturnType<typeof createApiClient>

const getOrder = (id: string, etag?: string) =>
  client.GET(ORDER_PATH, { params: { path: { id }, ...(etag ? { header: { 'If-None-Match': etag } } : {}) } })
const getReading = (id: string, etag?: string) =>
  client.GET(READING_PATH, { params: { path: { id }, ...(etag ? { header: { 'If-None-Match': etag } } : {}) } })

/** A code session on a free entitlement; returns its id. */
function login(code: string = syntheticCodes.available): string {
  accessMock.login({ code })
  const entitlement = accessMock.sessionEntitlement()
  if (!entitlement) throw new Error('no session')
  return entitlement.id
}

/** The session owns an order in the given state, as if it had been created earlier. */
function ownOrder(state: OrderState = states.queued, id: string = ID): string {
  const entitlementId = login()
  accessMock.consume(entitlementId, id)
  orderReadsMock.register({ id, entitlementId, state })
  return id
}

function visit(search: string): void {
  window.history.replaceState(null, '', `/${search}`)
}

beforeEach(() => {
  client = createApiClient()
  accessMock.reset()
  ordersMock.reset()
  orderReadsMock.reset()
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.unstubAllEnvs()
  accessMock.reset()
  ordersMock.reset()
  orderReadsMock.reset()
})

describe('the contract declares what the mock answers', () => {
  it.each([
    [ORDER_PATH, ['200', '304', '401', '404', '429', 'default']],
    [READING_PATH, ['200', '304', '401', '404', '409', '429', 'default']],
  ])('%s declares %j', (path, statuses) => {
    expect(declaredStatuses(path, 'get')).toEqual(statuses)
  })

  it('declares ETag and Cache-Control on 200 and 304, and Retry-After on 429', () => {
    for (const path of [ORDER_PATH, READING_PATH]) {
      expect(requiredHeaders(path, 'get', '200')).toEqual(['ETag', 'Cache-Control'])
      expect(requiredHeaders(path, 'get', '304')).toEqual(['ETag', 'Cache-Control'])
    }
  })

  it('has no body for 304 in the contract', () => {
    expect(responseBody(ORDER_PATH, 'get', '304')).toBeNull()
    expect(responseBody(READING_PATH, 'get', '304')).toBeNull()
  })

  it('names the new error code', () => {
    expect(schema('ErrorCode').enum).toContain('reading_not_ready')
  })
})

describe('GET /api/v1/orders/{id} over MSW', () => {
  it('answers 200 with the Order of the contract and the headers the contract requires', async () => {
    ownOrder(states.writing)

    const { data, response } = await getOrder(ID)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
    expect(response.headers.get('etag')).toMatch(/^W\/"[0-9a-f]+"$/)
    for (const name of requiredHeaders(ORDER_PATH, 'get', '200')) expect(response.headers.has(name), name).toBe(true)
    expect(check(responseBody(ORDER_PATH, 'get', '200') ?? {}, data)).toEqual([])
    expect(data).toMatchObject({ id: ID, status: 'writing', generation: { reading_ready: false, illustration_ready: false, can_resume: false } })
  })

  it('answers 304 without a body to the ETag it gave, with the headers the contract requires', async () => {
    ownOrder()
    const first = await getOrder(ID)
    const etag = first.response.headers.get('etag') ?? ''

    const { data, response } = await getOrder(ID, etag)

    expect(response.status).toBe(304)
    expect(data).toBeUndefined()
    expect(await response.text()).toBe('')
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('no-store')
    for (const name of requiredHeaders(ORDER_PATH, 'get', '304')) expect(response.headers.has(name), name).toBe(true)
  })

  it('answers 200 with a new ETag as soon as the status changes', async () => {
    ownOrder()
    const etag = (await getOrder(ID)).response.headers.get('etag') ?? ''

    orderReadsMock.advance(ID, states.writing)
    const { data, response } = await getOrder(ID, etag)

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).not.toBe(etag)
    expect(data?.status).toBe('writing')
  })

  it('answers 401 problem+json without a session', async () => {
    const { error, response } = await getOrder(ID)

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(error).toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(check(responseBody(ORDER_PATH, 'get', '401') ?? {}, error)).toEqual([])
  })

  it('answers 404 problem+json for a missing, a foreign and a non-UUID order alike', async () => {
    ownOrder()
    // An order of the other synthetic entitlement exists, but not for this session.
    orderReadsMock.register({ id: OTHER_ID, entitlementId: '00000000-0000-4000-8000-00000000f002' })

    const answers = await Promise.all([OTHER_ID, '00000000-0000-4000-8000-0000000f00ff', 'not-a-uuid', '12345'].map((id) => getOrder(id)))

    for (const { error, response } of answers) {
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toBe('application/problem+json')
      expect(error).toMatchObject({ status: 404, code: 'not_found' })
      expect(check(responseBody(ORDER_PATH, 'get', '404') ?? {}, error)).toEqual([])
    }
    expect(new Set(answers.map(({ error }) => JSON.stringify(error))).size).toBe(1)
    expect((await getOrder(ID)).response.status).toBe(200)
  })

  it('answers 401 once the code is bound to an account', async () => {
    const entitlementId = login()
    accessMock.consume(entitlementId, ID)
    orderReadsMock.register({ id: ID, entitlementId })
    expect((await getOrder(ID)).response.status).toBe(200)

    accessMock.bindToAccount(entitlementId)

    expect((await getOrder(ID)).response.status).toBe(401)
  })

  it('answers 429 with Retry-After when reading is too frequent', async () => {
    ownOrder()
    visit('?order-read=rate-limited')

    const { error, response } = await getOrder(ID)

    expect(response.status).toBe(429)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(error).toMatchObject({ status: 429, code: 'rate_limited' })
    expect(check(responseBody(ORDER_PATH, 'get', '429') ?? {}, error)).toEqual([])
  })

  it('answers a standard problem for a server failure and does not change the order', async () => {
    ownOrder()
    visit('?order-read=error')

    const { error, response } = await getOrder(ID)

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(check(schema('Problem'), error)).toEqual([])
    visit('')
    expect((await getOrder(ID)).data?.status).toBe('queued')
  })

  it('never puts a code into a response', async () => {
    ownOrder()

    const body = JSON.stringify((await getOrder(ID)).data)

    for (const code of Object.values(syntheticCodes)) expect(body).not.toContain(code)
    expect(body).not.toMatch(/LK-|FREE0/)
  })

  it('marks the response as mocked, as every handler does', async () => {
    ownOrder()

    expect((await getOrder(ID)).response.headers.get('x-cosmos-mock')).toBe('1')
  })
})

describe('reading is independent of the creation gate over MSW', () => {
  it('reads while the default configuration refuses to create', async () => {
    ownOrder()
    const entitlementId = accessMock.readAccess()?.entitlementId ?? ''
    expect((await client.GET('/api/v1/config')).data).toMatchObject({ legal_ready: false })
    const create = await client.POST('/api/v1/orders', {
      params: { header: { 'Idempotency-Key': 'order-key-0000000001' } },
      body: { entitlement_id: entitlementId, profile: { name: 'Анна', birth_date: '1990-03-12', place_id: 'ru-kzn', time: { kind: 'unknown' } }, consent_version: 'x' },
    })

    expect(create.response.status).toBe(403)
    expect(create.error).toMatchObject({ code: 'creation_unavailable' })
    expect((await getOrder(ID)).response.status).toBe(200)
  })

  it('reads a finished order and its text after the code is blocked', async () => {
    ownOrder(states.ready)
    accessMock.block(accessMock.readAccess()?.entitlementId ?? '')

    expect((await client.GET('/api/v1/session')).data).toEqual({ principal: 'anonymous' })
    expect((await getOrder(ID)).data?.status).toBe('ready')
    expect((await getReading(ID)).response.status).toBe(200)
  })
})

describe('GET /api/v1/orders/{id}/reading over MSW', () => {
  it('answers 200 with the Reading of the contract as soon as the text is accepted', async () => {
    ownOrder(states.illustrating)

    const { data, response } = await getReading(ID)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    for (const name of requiredHeaders(READING_PATH, 'get', '200')) expect(response.headers.has(name), name).toBe(true)
    expect(check(responseBody(READING_PATH, 'get', '200') ?? {}, data)).toEqual([])
  })

  it('answers 409 reading_not_ready while the text is being written, and the order itself stays readable', async () => {
    ownOrder(states.writing)

    const { error, response } = await getReading(ID)

    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(error).toMatchObject({ status: 409, code: 'reading_not_ready' })
    expect(check(schema('Problem'), error)).toEqual([])
    expect((await getOrder(ID)).response.status).toBe(200)
  })

  it('answers 304 to its own ETag', async () => {
    ownOrder(states.ready)
    const etag = (await getReading(ID)).response.headers.get('etag') ?? ''

    const { response } = await getReading(ID, etag)

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    for (const name of requiredHeaders(READING_PATH, 'get', '304')) expect(response.headers.has(name), name).toBe(true)
  })

  it('answers 401 and 404 like the order does', async () => {
    expect((await getReading(ID)).response.status).toBe(401)
    ownOrder(states.ready)
    expect((await getReading('not-a-uuid')).response.status).toBe(404)
  })

  it('answers 429 under the forced scenario', async () => {
    ownOrder(states.ready)
    visit('?order-read=rate-limited')

    const { response } = await getReading(ID)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).not.toBeNull()
  })
})

describe('dev switches of the stand', () => {
  it('moves an order one step along the happy path every third read with ?order-flow=auto', async () => {
    ownOrder(states.queued, '00000000-0000-4000-8000-0000000f0a01')
    visit('?order-flow=auto')

    const seen: string[] = []
    for (let i = 0; i < 9; i++) seen.push((await getOrder('00000000-0000-4000-8000-0000000f0a01')).data?.status ?? 'none')

    expect(seen).toEqual(['queued', 'queued', 'writing', 'writing', 'writing', 'illustrating', 'illustrating', 'illustrating', 'ready'])
  })

  it('stops the automatic flow at ready', async () => {
    ownOrder(states.illustrating, '00000000-0000-4000-8000-0000000f0a02')
    visit('?order-flow=auto')

    for (let i = 0; i < 12; i++) await getOrder('00000000-0000-4000-8000-0000000f0a02')

    expect(orderReadsMock.stateOf('00000000-0000-4000-8000-0000000f0a02')).toEqual(states.ready)
  })

  it('does not run the flow without the switch', async () => {
    ownOrder(states.queued, '00000000-0000-4000-8000-0000000f0a03')

    for (let i = 0; i < 9; i++) await getOrder('00000000-0000-4000-8000-0000000f0a03')

    expect(orderReadsMock.stateOf('00000000-0000-4000-8000-0000000f0a03')).toEqual(states.queued)
  })
})

describe('an order created through the page flow becomes readable', () => {
  const key = 'order-key-0000000042'

  async function createInTestMode(search: string, profile: Schemas['Profile']): Promise<string> {
    visit(search)
    vi.stubEnv('VITE_API_MOCKS', '1')
    const { data } = await client.POST('/api/v1/auth/code', { body: { code: syntheticCodes.available } })
    if (data?.entitlement.state !== 'available') throw new Error('no free entitlement')
    const created = await client.POST('/api/v1/orders', {
      params: { header: { 'Idempotency-Key': key } },
      body: { entitlement_id: data.entitlement.id, profile, consent_version: TEST_CONSENT_VERSION },
    })
    if (!created.data) throw new Error(`not created: ${String(created.response.status)}`)
    return created.data.id
  }

  const known: Schemas['Profile'] = {
    name: 'Анна',
    birth_date: '1990-03-12',
    place_id: 'ru-kzn',
    time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 },
  }

  it('is queued with a known chart and the order the session now owns', async () => {
    const id = await createInTestMode('?creation=test', known)

    const { data } = await getOrder(id)
    expect(data).toMatchObject({ id, status: 'queued', chart: { mode: 'known' } })
    expect((await client.GET('/api/v1/session')).data).toMatchObject({ entitlement: { state: 'consumed', order_id: id } })
  })

  it('takes the state and the chart from the dev switches', async () => {
    const id = await createInTestMode('?creation=test&order-state=needs_review:review&order-chart=polar', known)

    const { data } = await getOrder(id)

    expect(data?.status).toBe('needs_review')
    expect(data?.generation).toMatchObject({ stop_reason: 'review', reading_ready: false })
    expect(data?.generation.support_reference).toMatch(/^REV-TEST-/)
    expect(data?.chart.warnings).toEqual([{ code: 'houses_unavailable' }])
  })

  it('gets a range chart for a time with an error and an unknown chart for an unknown time', async () => {
    const range = await createInTestMode('?creation=test', { ...known, time: { kind: 'known', value: '14:30', source: 'family', accuracy_minutes: 15 } })
    expect((await getOrder(range)).data?.chart).toMatchObject({ mode: 'range', time_basis: { reference_moment: 'interval_midpoint', uncertainty_minutes: 15 } })

    accessMock.reset()
    ordersMock.reset()
    orderReadsMock.reset()
    const unknown = await createInTestMode('?creation=test', { ...known, time: { kind: 'unknown' } })
    expect((await getOrder(unknown)).data?.chart).toMatchObject({ mode: 'unknown', time_basis: { reference_moment: 'local_noon' } })
  })
})
