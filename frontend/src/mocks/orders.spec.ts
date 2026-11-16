import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from '@/api/client'
import type { components } from '@/api/schema'

import { createAccessMock, syntheticCodes, type AccessMock } from './access'
import { publicConfig, TEST_CONSENT_VERSION } from './fixtures'
import { accessMock, creationTestMode, ordersMock } from './handlers'
import { createOrdersMock, IDEMPOTENCY_KEY, type CreationGate, type OrdersMock, type OrdersScenario } from './orders'

type Schemas = components['schemas']

const open: CreationGate = { legalReady: true, generation: true }
const profile: Schemas['Profile'] = {
  name: 'Анна',
  birth_date: '1990-03-12',
  place_id: 'ru-kzn',
  time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 },
}

const key = (n: number): string => `order-key-${String(n).padStart(10, '0')}`

interface Stand {
  access: AccessMock
  orders: OrdersMock
  entitlementId: string
  body: (overrides?: Partial<Schemas['CreateOrder']>) => Schemas['CreateOrder']
}

/** A mock server with a code session on a free entitlement. */
function stand(gate: CreationGate = open, code: string = syntheticCodes.available): Stand {
  const access = createAccessMock()
  const orders = createOrdersMock(access, () => gate)
  access.login({ code })
  const entitlement = access.sessionEntitlement()
  if (!entitlement) throw new Error('the stand has no session')
  return {
    access,
    orders,
    entitlementId: entitlement.id,
    body: (overrides = {}) => ({ entitlement_id: entitlement.id, profile, consent_version: TEST_CONSENT_VERSION, ...overrides }),
  }
}

const sessionState = (access: AccessMock): string | undefined => {
  const entitlement = access.sessionEntitlement()
  return entitlement?.state
}

describe('default configuration', () => {
  it('is closed: no legal clearance, no consent text, no generation', () => {
    expect(publicConfig.legal_ready).toBe(false)
    expect(publicConfig.consent_version).toBe('')
    expect(publicConfig.features.generation).toBe(false)
  })

  it('has no consent text of its own', () => {
    expect(TEST_CONSENT_VERSION).toMatch(/^test-/)
  })
})

describe('creation gate', () => {
  it.each<[string, CreationGate]>([
    ['legal_ready is false', { legalReady: false, generation: true }],
    ['generation is off', { legalReady: true, generation: false }],
    ['both are closed', { legalReady: false, generation: false }],
  ])('answers 403 creation_unavailable when %s', (_name, gate) => {
    const { access, orders, body } = stand(gate)

    const outcome = orders.create({ key: key(1), body: body() })

    expect(outcome).toMatchObject({ status: 403, code: 'creation_unavailable' })
    expect(sessionState(access)).toBe('available')
    expect(orders.orderCount()).toBe(0)
  })

  it('stays closed however many times the client tries', () => {
    const { access, orders, body } = stand({ legalReady: false, generation: true })

    for (let i = 1; i <= 5; i++) expect(orders.create({ key: key(i), body: body() }).status).toBe(403)

    expect(sessionState(access)).toBe('available')
    expect(orders.orderCount()).toBe(0)
  })

  it('has no scenario that opens it or creates an order behind it', () => {
    const { access, orders, body } = stand({ legalReady: false, generation: false })
    const scenarios: OrdersScenario[] = ['consent-outdated', 'used', 'calculation-failed', 'nonexistent', 'ambiguous']

    for (const scenario of scenarios) {
      expect(orders.create({ key: key(1), body: body(), scenario })).toMatchObject({ status: 403, code: 'creation_unavailable' })
    }
    expect(sessionState(access)).toBe('available')
    expect(orders.orderCount()).toBe(0)
  })
})

describe('request checks', () => {
  it('answers 401 without a session', () => {
    const access = createAccessMock()
    const orders = createOrdersMock(access, () => open)

    const outcome = orders.create({
      key: key(1),
      body: { entitlement_id: '00000000-0000-4000-8000-00000000f001', profile, consent_version: TEST_CONSENT_VERSION },
    })

    expect(outcome).toMatchObject({ status: 401, code: 'unauthenticated' })
  })

  it.each<[string, string | null]>([
    ['no key', null],
    ['a short key', 'short'],
    ['a key with forbidden characters', 'order key with spaces 0001'],
    ['a key over 80 characters', 'k'.repeat(81)],
  ])('answers 400 for %s', (_name, badKey) => {
    const { orders, body } = stand()

    expect(orders.create({ key: badKey, body: body() })).toMatchObject({ status: 400, code: 'validation_failed' })
    expect(orders.orderCount()).toBe(0)
  })

  it('accepts keys in the contract range', () => {
    expect(IDEMPOTENCY_KEY.test('k'.repeat(16))).toBe(true)
    expect(IDEMPOTENCY_KEY.test('k'.repeat(80))).toBe(true)
    expect(IDEMPOTENCY_KEY.test('k'.repeat(15))).toBe(false)
    expect(IDEMPOTENCY_KEY.test(crypto.randomUUID())).toBe(true)
  })

  it.each<[string, unknown]>([
    ['not an object', 'text'],
    ['an unknown field', { entitlement_id: '00000000-0000-4000-8000-00000000f001', profile, consent_version: 'x', extra: 1 }],
    ['a missing consent version', { entitlement_id: '00000000-0000-4000-8000-00000000f001', profile }],
    ['an empty consent version', { entitlement_id: '00000000-0000-4000-8000-00000000f001', profile, consent_version: '' }],
    ['an entitlement id that is not a uuid', { entitlement_id: 'abc', profile, consent_version: 'x' }],
    ['a profile of the wrong shape', { entitlement_id: '00000000-0000-4000-8000-00000000f001', profile: { name: 'Анна' }, consent_version: 'x' }],
  ])('answers 400 for %s', (_name, body) => {
    const { orders } = stand()

    expect(orders.create({ key: key(1), body })).toMatchObject({ status: 400, code: 'validation_failed' })
  })

  it('answers 404 for an entitlement outside the session and reveals nothing', () => {
    const { access, orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body({ entitlement_id: '00000000-0000-4000-8000-00000000f002' }) })

    expect(outcome).toMatchObject({ status: 404, code: 'not_found' })
    expect(JSON.stringify(outcome)).not.toContain('f002')
    expect(sessionState(access)).toBe('available')
  })
})

describe('creating an order', () => {
  it('answers 201 queued and spends the entitlement', () => {
    const { access, orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body() })

    expect(outcome).toMatchObject({ status: 201, body: { status: 'queued' } })
    expect(outcome).toEqual({ status: 201, body: { id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string, status: 'queued' } })
    expect(orders.orderCount()).toBe(1)
    expect(sessionState(access)).toBe('consumed')
  })

  it('lets the session recover the order id', () => {
    const { access, orders, body } = stand()
    const outcome = orders.create({ key: key(1), body: body() })

    const session = access.session()

    expect(outcome.status).toBe(201)
    expect(session).toMatchObject({ principal: 'code', entitlement: { state: 'consumed' } })
    expect(session.principal === 'code' && session.entitlement.state === 'consumed' && session.entitlement.order_id).toBe(
      'body' in outcome && outcome.body.id,
    )
  })

  it('does not report readiness, only the queue', () => {
    const { orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body() })

    expect('body' in outcome && outcome.body.status).toBe('queued')
    expect(JSON.stringify(outcome)).not.toMatch(/ready|готов/i)
  })
})

describe('idempotency', () => {
  it('returns the same order for a double submission with the same key', () => {
    const { orders, body } = stand()

    const first = orders.create({ key: key(1), body: body() })
    const second = orders.create({ key: key(1), body: body() })

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect('body' in second && second.body).toEqual('body' in first && first.body)
    expect(orders.orderCount()).toBe(1)
  })

  it('treats the same request in another form as the same request', () => {
    const { orders, body } = stand()
    orders.create({ key: key(1), body: body() })

    const respaced = orders.create({ key: key(1), body: body({ profile: { ...profile, name: '  Анна  ' } }) })

    expect(respaced.status).toBe(200)
    expect(orders.orderCount()).toBe(1)
  })

  it('refuses the same key with another profile and creates nothing', () => {
    const { orders, body } = stand()
    orders.create({ key: key(1), body: body() })

    const outcome = orders.create({ key: key(1), body: body({ profile: { ...profile, name: 'Борис' } }) })

    expect(outcome).toMatchObject({ status: 409, code: 'idempotency_key_reused' })
    expect(orders.orderCount()).toBe(1)
  })

  it('counts the consent version into the request (К11)', () => {
    const { orders, body } = stand()
    orders.create({ key: key(1), body: body() })

    const outcome = orders.create({ key: key(1), body: body({ consent_version: 'test-consent-v9' }) })

    expect(outcome).toMatchObject({ status: 409, code: 'idempotency_key_reused' })
    expect(orders.orderCount()).toBe(1)
  })

  it('answers 200 with the same order for the same request under another key (two tabs)', () => {
    const { orders, body } = stand()
    const first = orders.create({ key: key(1), body: body() })

    const second = orders.create({ key: key(2), body: body() })

    expect(second.status).toBe(200)
    expect('body' in second && second.body.id).toBe('body' in first && first.body.id)
    expect(orders.orderCount()).toBe(1)
  })

  it('answers 409 entitlement_used for another request under another key', () => {
    const { orders, body } = stand()
    orders.create({ key: key(1), body: body() })

    const outcome = orders.create({ key: key(2), body: body({ profile: { ...profile, birth_date: '1991-04-01' } }) })

    expect(outcome).toMatchObject({ status: 409, code: 'entitlement_used' })
    expect(orders.orderCount()).toBe(1)
  })

  it('does not hand a used code a second order', () => {
    const { access, orders, body } = stand(open, syntheticCodes.consumed)

    const outcome = orders.create({ key: key(1), body: body() })

    expect(outcome).toMatchObject({ status: 409, code: 'entitlement_used' })
    expect(sessionState(access)).toBe('consumed')
    expect(orders.orderCount()).toBe(0)
  })

  it('creates exactly one order out of many identical submissions', () => {
    const { orders, body } = stand()

    const statuses = Array.from({ length: 8 }, () => orders.create({ key: key(1), body: body() }).status)

    expect(statuses).toEqual([201, 200, 200, 200, 200, 200, 200, 200])
    expect(orders.orderCount()).toBe(1)
  })
})

describe('consent version', () => {
  it('answers 409 consent_outdated for a stale version and spends nothing', () => {
    const { access, orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body({ consent_version: 'test-consent-v-1' }) })

    expect(outcome).toMatchObject({ status: 409, code: 'consent_outdated' })
    expect(sessionState(access)).toBe('available')
    expect(orders.orderCount()).toBe(0)
  })

  it('moves the server version in the consent-outdated scenario and accepts the new one with a new key', () => {
    const { access, orders, body } = stand()

    const stale = orders.create({ key: key(1), body: body(), scenario: 'consent-outdated' })
    const fresh = orders.create({ key: key(2), body: body({ consent_version: orders.consentVersion() }) })

    expect(stale).toMatchObject({ status: 409, code: 'consent_outdated' })
    expect(orders.consentVersion()).not.toBe(TEST_CONSENT_VERSION)
    expect(fresh.status).toBe(201)
    expect(sessionState(access)).toBe('consumed')
  })
})

describe('definite refusals before creation keep the entitlement available', () => {
  const refusals: [string, OrdersScenario | null, Partial<Schemas['CreateOrder']>, number, string][] = [
    ['an empty name', null, { profile: { ...profile, name: '   ' } }, 422, 'validation_failed'],
    ['an unknown place', null, { profile: { ...profile, place_id: 'xx-none' } }, 422, 'place_not_found'],
    ['a skipped hour', 'nonexistent', {}, 422, 'birth_time_nonexistent'],
    ['a repeated hour', 'ambiguous', {}, 422, 'birth_time_ambiguous'],
    ['a failed calculation', 'calculation-failed', {}, 422, 'calculation_failed'],
    ['a stale consent', null, { consent_version: 'test-consent-v-1' }, 409, 'consent_outdated'],
    ['the rate limit', 'rate-limited', {}, 429, 'rate_limited'],
  ]

  it.each(refusals)('%s', (_name, scenario, overrides, status, code) => {
    const { access, orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body(overrides), scenario })

    expect(outcome).toMatchObject({ status, code })
    expect(sessionState(access)).toBe('available')
    expect(orders.orderCount()).toBe(0)
  })

  it('reports fields for a profile refusal, as profile-checks does', () => {
    const { orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body({ profile: { ...profile, name: '' } }) })

    expect(outcome).toMatchObject({ status: 422, fields: { name: expect.any(String) as string } })
  })

  it('sends Retry-After with the rate limit', () => {
    const { orders, body } = stand()

    expect(orders.create({ key: key(1), body: body(), scenario: 'rate-limited' })).toMatchObject({ retryAfter: 60 })
  })

  it('lets the corrected request create the order under the same key', () => {
    const { access, orders, body } = stand()
    orders.create({ key: key(1), body: body({ profile: { ...profile, name: '' } }) })

    const outcome = orders.create({ key: key(1), body: body() })

    expect(outcome.status).toBe(201)
    expect(sessionState(access)).toBe('consumed')
  })

  it('answers 409 entitlement_blocked and ends the session of a blocked code', () => {
    const { access, orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body(), scenario: 'blocked' })

    expect(outcome).toMatchObject({ status: 409, code: 'entitlement_blocked' })
    expect(access.session()).toEqual({ principal: 'anonymous' })
    expect(orders.orderCount()).toBe(0)
  })

  it('shows another tab\'s order after entitlement_used, so the client can open it', () => {
    const { access, orders, body } = stand()

    const outcome = orders.create({ key: key(1), body: body(), scenario: 'used' })
    const entitlement = access.sessionEntitlement()

    expect(outcome).toMatchObject({ status: 409, code: 'entitlement_used' })
    expect(entitlement).toMatchObject({ state: 'consumed', orderId: expect.any(String) as string })
  })
})

describe('order messages', () => {
  it('never echo a code or an entitlement id from another session', () => {
    const { orders, body } = stand()
    const outcomes = [
      orders.create({ key: key(1), body: body({ entitlement_id: '00000000-0000-4000-8000-00000000f002' }) }),
      orders.create({ key: key(2), body: body({ consent_version: 'test-consent-v-1' }) }),
      orders.create({ key: key(3), body: body(), scenario: 'calculation-failed' }),
    ]
    const text = JSON.stringify(outcomes)

    for (const code of Object.values(syntheticCodes)) expect(text).not.toContain(code)
    expect(text).not.toContain('f002')
  })
})

describe('order handlers over MSW', () => {
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const
  let client: ReturnType<typeof createApiClient>
  let consoleSpies: ReturnType<typeof vi.spyOn>[] = []

  const post = (n: number, body: Schemas['CreateOrder']) => client.POST('/api/v1/orders', { params: { header: { 'Idempotency-Key': key(n) } }, body })

  async function login(): Promise<string> {
    const { data } = await client.POST('/api/v1/auth/code', { body: { code: syntheticCodes.available } })
    if (data?.entitlement.state !== 'available') throw new Error('no free entitlement')
    return data.entitlement.id
  }

  function mockPage(search: string, mocksOn: boolean): void {
    window.history.replaceState(null, '', `/${search}`)
    if (mocksOn) vi.stubEnv('VITE_API_MOCKS', '1')
  }

  beforeEach(() => {
    client = createApiClient()
    accessMock.reset()
    ordersMock.reset()
    consoleSpies = consoleMethods.map((method) => vi.spyOn(console, method))
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    vi.unstubAllEnvs()
    accessMock.reset()
    ordersMock.reset()
  })

  function body(entitlementId: string, overrides: Partial<Schemas['CreateOrder']> = {}): Schemas['CreateOrder'] {
    return { entitlement_id: entitlementId, profile, consent_version: TEST_CONSENT_VERSION, ...overrides }
  }

  describe('without the explicit test mode', () => {
    it('serves a closed configuration and refuses to create', async () => {
      const entitlementId = await login()

      expect((await client.GET('/api/v1/config')).data).toEqual(publicConfig)
      const { error, response } = await post(1, body(entitlementId))

      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toBe('application/problem+json')
      expect(error).toMatchObject({ status: 403, code: 'creation_unavailable' })
      expect((await client.GET('/api/v1/session')).data).toMatchObject({ entitlement: { state: 'available' } })
      expect(ordersMock.orderCount()).toBe(0)
    })

    it('ignores ?creation=test while mocks are not switched on', async () => {
      mockPage('?creation=test', false)
      const entitlementId = await login()

      expect(creationTestMode()).toBe(false)
      expect((await client.GET('/api/v1/config')).data).toMatchObject({ legal_ready: false, consent_version: '' })
      expect((await post(1, body(entitlementId))).response.status).toBe(403)
      expect(ordersMock.orderCount()).toBe(0)
    })

    it('ignores the mock switch without ?creation=test', async () => {
      mockPage('', true)
      const entitlementId = await login()

      expect(creationTestMode()).toBe(false)
      expect((await post(1, body(entitlementId))).response.status).toBe(403)
    })

    it('does not let a dev scenario open the gate', async () => {
      mockPage('?orders=used', true)
      const entitlementId = await login()

      expect((await post(1, body(entitlementId))).response.status).toBe(403)
      expect(ordersMock.orderCount()).toBe(0)
      expect((await client.GET('/api/v1/session')).data).toMatchObject({ entitlement: { state: 'available' } })
    })
  })

  describe('in the explicit test mode (dev build, MSW, ?creation=test)', () => {
    beforeEach(() => {
      mockPage('?creation=test', true)
    })

    it('opens the gate and names a test consent version', async () => {
      expect(creationTestMode()).toBe(true)
      expect((await client.GET('/api/v1/config')).data).toMatchObject({
        legal_ready: true,
        consent_version: TEST_CONSENT_VERSION,
        features: { generation: true },
      })
    })

    it('creates an order and lets the session recover its id', async () => {
      const entitlementId = await login()

      const created = await post(1, body(entitlementId))
      const session = await client.GET('/api/v1/session')

      expect(created.response.status).toBe(201)
      expect(created.data).toMatchObject({ status: 'queued' })
      expect(session.data).toMatchObject({ entitlement: { state: 'consumed', order_id: created.data?.id } })
    })

    it('creates one order for a double submission sent at once', async () => {
      const entitlementId = await login()

      const [a, b] = await Promise.all([post(1, body(entitlementId)), post(1, body(entitlementId))])

      expect([a.response.status, b.response.status].sort()).toEqual([200, 201])
      expect(a.data?.id).toBe(b.data?.id)
      expect(ordersMock.orderCount()).toBe(1)
    })

    it('recovers from a lost answer: the session shows the order, the retry with the same key returns it', async () => {
      const entitlementId = await login()
      ordersMock.inject('lost-response')

      await expect(post(1, body(entitlementId))).rejects.toThrow()
      const session = await client.GET('/api/v1/session')
      const orderId = session.data?.principal === 'code' && session.data.entitlement.state === 'consumed' && session.data.entitlement.order_id
      const retry = await post(1, body(entitlementId))

      expect(orderId).toEqual(expect.any(String))
      expect(retry.response.status).toBe(200)
      expect(retry.data?.id).toBe(orderId)
      expect(ordersMock.orderCount()).toBe(1)
    })

    it('creates once after a lost request: the session stays available, the retry with the same key creates', async () => {
      const entitlementId = await login()
      ordersMock.inject('lost-request')

      await expect(post(1, body(entitlementId))).rejects.toThrow()
      expect((await client.GET('/api/v1/session')).data).toMatchObject({ entitlement: { state: 'available' } })
      const retry = await post(1, body(entitlementId))

      expect(retry.response.status).toBe(201)
      expect(ordersMock.orderCount()).toBe(1)
    })

    it('treats a 5xx after the commit as unknown, and the same key returns the order', async () => {
      const entitlementId = await login()
      ordersMock.inject('error-after-commit')

      const failed = await post(1, body(entitlementId))
      const retry = await post(1, body(entitlementId))

      expect(failed.response.status).toBe(503)
      expect(failed.error).toMatchObject({ code: 'internal_error' })
      expect(retry.response.status).toBe(200)
      expect(ordersMock.orderCount()).toBe(1)
    })

    it('does not create a second order for a retry under a new key after an unknown outcome with another request', async () => {
      const entitlementId = await login()
      ordersMock.inject('lost-response')
      await expect(post(1, body(entitlementId))).rejects.toThrow()

      const other = await post(2, body(entitlementId, { profile: { ...profile, name: 'Борис' } }))

      expect(other.response.status).toBe(409)
      expect(other.error).toMatchObject({ code: 'entitlement_used' })
      expect(ordersMock.orderCount()).toBe(1)
    })

    it('answers 401 once the session is gone', async () => {
      const { error, response } = await post(1, body('00000000-0000-4000-8000-00000000f001'))

      expect(response.status).toBe(401)
      expect(error).toMatchObject({ code: 'unauthenticated' })
    })

    it('writes nothing to the console', async () => {
      const entitlementId = await login()
      await post(1, body(entitlementId))
      await post(1, body(entitlementId))
      await post(2, body(entitlementId, { profile: { ...profile, name: 'Борис' } }))

      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    })
  })

  describe.each<[string, string, number, string]>([
    ['error', '?creation=test&orders=error', 503, 'internal_error'],
    ['rate-limited', '?creation=test&orders=rate-limited', 429, 'rate_limited'],
    ['calculation-failed', '?creation=test&orders=calculation-failed', 422, 'calculation_failed'],
    ['consent-outdated', '?creation=test&orders=consent-outdated', 409, 'consent_outdated'],
  ])('dev switch ?orders=%s', (_name, search, status, code) => {
    it(`answers ${String(status)} ${code} and keeps the entitlement available`, async () => {
      mockPage(search, true)
      const entitlementId = await login()

      const { error, response } = await post(1, body(entitlementId))

      expect(response.status).toBe(status)
      expect(error).toMatchObject({ code })
      expect((await client.GET('/api/v1/session')).data).toMatchObject({ entitlement: { state: 'available' } })
      expect(ordersMock.orderCount()).toBe(0)
    })
  })

  it('sends Retry-After with the rate limit', async () => {
    mockPage('?creation=test&orders=rate-limited', true)
    const entitlementId = await login()

    const { response } = await post(1, body(entitlementId))

    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('serves the moved consent version after consent-outdated, so the screen can ask again', async () => {
    mockPage('?creation=test&orders=consent-outdated', true)
    const entitlementId = await login()

    await post(1, body(entitlementId))
    const config = (await client.GET('/api/v1/config')).data
    const retry = await post(2, body(entitlementId, { consent_version: config?.consent_version ?? '' }))

    expect(config?.consent_version).not.toBe(TEST_CONSENT_VERSION)
    expect(retry.response.status).toBe(201)
  })
})

describe('production build', () => {
  const sources = import.meta.glob<string>('/src/**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })
  const isTestOrMock = (path: string): boolean => path.includes('/src/mocks/') || path.includes('/src/test/') || path.endsWith('.spec.ts')

  it('reaches the mocks only from main.ts, behind the dev and MSW switches', () => {
    const importers = Object.entries(sources)
      .filter(([path]) => !isTestOrMock(path))
      .filter(([, text]) => /['"](@\/mocks|\.{1,2}\/mocks)[/'"]/.test(text))
      .map(([path]) => path)

    expect(importers).toEqual(['/src/main.ts'])
    const main = sources['/src/main.ts'] ?? ''
    const guard = main.indexOf("if (!import.meta.env.DEV || import.meta.env.VITE_API_MOCKS !== '1') return")
    expect(guard).toBeGreaterThan(-1)
    expect(main.indexOf("import('./mocks/browser')")).toBeGreaterThan(guard)
  })

  it('has no creation test path outside the mocks', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !isTestOrMock(path))
      .filter(([, text]) => /creationTestMode|testCreationConfig|creation=test|TEST_CONSENT_VERSION/.test(text))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
