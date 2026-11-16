import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublicConfig } from '@/api/client'
import { ApiProblem } from '@/api/problem'
import { syntheticCodes } from '@/mocks/access'
import { publicConfig, TEST_CONSENT_VERSION, testCreationConfig } from '@/mocks/fixtures'
import { accessMock, ordersMock } from '@/mocks/handlers'
import { server } from '@/mocks/node'
import type { Profile } from '@/features/intake/review'

import {
  ATTEMPT_KEY,
  ATTEMPT_TTL_MS,
  clearAttempt,
  consentTexts,
  creationMode,
  isOrderId,
  loadSetup,
  openAttempt,
  OrderRefused,
  orderFailure,
  parseAttempt,
  placeOrder,
  recoverOrderId,
  renewAttempt,
  summaryOf,
  type AttemptScope,
} from './consent'

const ORDERS = '/api/v1/orders'
const ENTITLEMENT = '00000000-0000-4000-8000-00000000f001'
const ORDER = '00000000-0000-4000-8000-0000000e0001'

const profile: Profile = {
  name: 'Тестовая Вега',
  birth_date: '1990-03-12',
  place_id: 'ru-kzn',
  time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 },
}

const scope: AttemptScope = { entitlementId: ENTITLEMENT, fingerprint: 'a'.repeat(64), consentVersion: TEST_CONSENT_VERSION }

function problem(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return HttpResponse.json({ type: 'about:blank', title: 'Error', status, ...body }, { status, headers: { 'content-type': 'application/problem+json', ...headers } })
}

const request = { key: 'k'.repeat(36), entitlementId: ENTITLEMENT, profile, consentVersion: TEST_CONSENT_VERSION }

beforeEach(() => {
  sessionStorage.clear()
  accessMock.reset()
  ordersMock.reset()
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.unstubAllEnvs()
})

describe('creationMode: closed unless every condition holds', () => {
  const open: PublicConfig = testCreationConfig()

  it.each<[string, PublicConfig, boolean, boolean, string]>([
    ['the default configuration', publicConfig, false, true, 'blocked'],
    ['the default configuration on the stand', publicConfig, true, true, 'blocked'],
    ['legal_ready=false with generation on', { ...open, legal_ready: false }, true, true, 'blocked'],
    ['an empty consent version', { ...open, consent_version: '' }, true, true, 'blocked'],
    ['generation off', { ...open, features: { ...open.features, generation: false } }, true, true, 'generation_off'],
    ['legal_ready=false and generation off', { ...publicConfig, features: { ...publicConfig.features, generation: false } }, true, true, 'blocked'],
    ['an open configuration of a real server (not the stand)', open, false, true, 'blocked'],
    ['an open configuration claimed by a production build', open, true, false, 'blocked'],
    ['the stand with the explicit test configuration', open, true, true, 'test'],
  ])('%s → %s', (_name, config, mocked, devBuild, expected) => {
    expect(creationMode({ config, mocked, devBuild })).toBe(expected)
  })
})

describe('summaryOf', () => {
  it('writes the date, the place and the time as one line', () => {
    expect(summaryOf(profile, { name: 'Казань' })).toEqual({ name: 'Тестовая Вега', details: '12 марта 1990 · Казань · 14:30' })
  })

  it('says the time is unknown instead of showing a clock', () => {
    expect(summaryOf({ ...profile, time: { kind: 'unknown' } }, { name: 'Казань' }).details).toBe('12 марта 1990 · Казань · время неизвестно')
  })
})

describe('the idempotency attempt (SCR-05 §0.7)', () => {
  it('creates a key of the contract shape and stores no code and no profile', () => {
    const attempt = openAttempt(scope)

    expect(attempt.key).toMatch(/^[A-Za-z0-9_-]{16,80}$/)
    const stored = sessionStorage.getItem(ATTEMPT_KEY) ?? ''
    expect(JSON.parse(stored)).toEqual({ ...scope, key: attempt.key, createdAt: attempt.createdAt })
    expect(stored).not.toContain('Вега')
    expect(stored).not.toContain('ru-kzn')
  })

  it('keeps the key on a re-entry with the same access, profile and consent version', () => {
    const first = openAttempt(scope)
    expect(openAttempt(scope).key).toBe(first.key)
  })

  it.each<[string, Partial<AttemptScope>]>([
    ['another access', { entitlementId: '00000000-0000-4000-8000-00000000f002' }],
    ['a changed profile', { fingerprint: 'b'.repeat(64) }],
    ['another consent version', { consentVersion: `${TEST_CONSENT_VERSION}1` }],
  ])('makes a new key for %s', (_name, change) => {
    const first = openAttempt(scope)
    const next = openAttempt({ ...scope, ...change })

    expect(next.key).not.toBe(first.key)
    expect(JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? '{}')).toMatchObject({ key: next.key })
  })

  it('makes a new key on demand and forgets the old one', () => {
    const first = openAttempt(scope)
    expect(renewAttempt(scope).key).not.toBe(first.key)
  })

  it('drops an expired, damaged or foreign record', () => {
    const now = Date.now()
    const good = JSON.stringify({ ...scope, key: 'k'.repeat(36), createdAt: now })

    expect(parseAttempt(good, now)?.key).toBe('k'.repeat(36))
    expect(parseAttempt(good, now + ATTEMPT_TTL_MS + 1)).toBeNull()
    expect(parseAttempt(JSON.stringify({ ...scope, key: 'short', createdAt: now }), now)).toBeNull()
    expect(parseAttempt(JSON.stringify({ ...scope, key: 'k'.repeat(36) }), now)).toBeNull()
    expect(parseAttempt('{broken', now)).toBeNull()
    expect(parseAttempt(null, now)).toBeNull()
  })

  it('is removed on success', () => {
    openAttempt(scope)
    clearAttempt()
    expect(sessionStorage.getItem(ATTEMPT_KEY)).toBeNull()
  })

  it('keeps working in memory when storage refuses', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(openAttempt(scope).key).toMatch(/^[A-Za-z0-9_-]{16,80}$/)
    setItem.mockRestore()
  })
})

describe('orderFailure: what each answer means', () => {
  const failure = (status: number, code: ApiProblem['code'], detail?: string) => orderFailure(new ApiProblem(status, code, detail))

  it.each<[number, ApiProblem['code'], string]>([
    [401, 'unauthenticated', 'signed_out'],
    [403, 'creation_unavailable', 'unavailable'],
    [404, 'not_found', 'stale'],
    [409, 'consent_outdated', 'consent_outdated'],
    [409, 'entitlement_used', 'entitlement_used'],
    [409, 'entitlement_blocked', 'entitlement_blocked'],
    [409, 'idempotency_key_reused', 'key_reused'],
    [422, 'validation_failed', 'fix_profile'],
    [422, 'place_not_found', 'fix_profile'],
    [422, 'birth_time_nonexistent', 'fix_profile'],
    [422, 'birth_time_ambiguous', 'fix_profile'],
    [422, 'calculation_failed', 'calculation_failed'],
    [429, 'rate_limited', 'limited'],
    [400, 'validation_failed', 'failed'],
    [400, 'unexpected_response', 'failed'],
    [0, 'network', 'unknown'],
    [500, 'internal_error', 'unknown'],
    [503, 'internal_error', 'unknown'],
    [502, 'unexpected_response', 'unknown'],
  ])('%i %s → %s', (status, code, kind) => {
    expect(failure(status, code).kind).toBe(kind)
  })

  it('shows the server text for a profile error and its own text otherwise', () => {
    expect(failure(422, 'birth_time_ambiguous', 'Это время бывает дважды.')).toEqual({ kind: 'fix_profile', message: 'Это время бывает дважды.' })
    expect(failure(422, 'validation_failed')).toEqual({ kind: 'fix_profile', message: consentTexts.fixProfile })
    expect(failure(429, 'rate_limited')).toMatchObject({ message: consentTexts.rateLimited, retryAfter: null })
    expect(orderFailure(new ApiProblem(429, 'rate_limited', 'Подожди.'), 30)).toEqual({ kind: 'limited', message: 'Подожди.', retryAfter: 30 })
  })

  it('does not echo the server text of a general failure', () => {
    expect(failure(400, 'validation_failed', 'internal detail')).toEqual({ kind: 'failed', message: consentTexts.failed })
  })
})

describe('isOrderId', () => {
  it('accepts a UUID and nothing a router could misread', () => {
    expect(isOrderId(ORDER)).toBe(true)
    for (const value of ['', 'demo', '../orders', ORDER + '/x', 42, null, undefined]) expect(isOrderId(value)).toBe(false)
  })
})

describe('placeOrder', () => {
  it('sends the key, the access, the profile and the consent version, and returns the confirmed id', async () => {
    let seen: { key: string | null; body: unknown } | null = null
    server.use(
      http.post(ORDERS, async ({ request: req }) => {
        seen = { key: req.headers.get('idempotency-key'), body: await req.clone().json() }
        return HttpResponse.json({ id: ORDER, status: 'queued' }, { status: 201 })
      }),
    )

    await expect(placeOrder(request, new AbortController().signal)).resolves.toBe(ORDER)
    expect(seen).toEqual({
      key: request.key,
      body: { entitlement_id: ENTITLEMENT, profile, consent_version: TEST_CONSENT_VERSION },
    })
  })

  it('treats 200 (the same order again) as a confirmation too', async () => {
    server.use(http.post(ORDERS, () => HttpResponse.json({ id: ORDER, status: 'queued' }, { status: 200 })))
    await expect(placeOrder(request, new AbortController().signal)).resolves.toBe(ORDER)
  })

  async function refusal(): Promise<OrderRefused> {
    const error: unknown = await placeOrder(request, new AbortController().signal).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(OrderRefused)
    return error as OrderRefused
  }

  it.each([
    ['a lost request', () => HttpResponse.error()],
    ['a 503', () => problem(503, { code: 'internal_error' })],
    ['a 502 without a problem body', () => new HttpResponse('bad gateway', { status: 502 })],
    ['a success without an order id', () => HttpResponse.json({ status: 'queued' }, { status: 201 })],
    ['a success with an id the router must not carry', () => HttpResponse.json({ id: '../x', status: 'queued' }, { status: 201 })],
    ['a success that is not JSON', () => new HttpResponse('ok', { status: 201 })],
  ])('reads %s as an unknown outcome', async (_name, reply) => {
    server.use(http.post(ORDERS, reply))
    expect((await refusal()).failure).toEqual({ kind: 'unknown' })
  })

  it('reads the refusals and Retry-After', async () => {
    server.use(http.post(ORDERS, () => problem(429, { code: 'rate_limited' }, { 'retry-after': '45' })))
    expect((await refusal()).failure).toMatchObject({ kind: 'limited', retryAfter: 45 })

    server.use(http.post(ORDERS, () => problem(409, { code: 'consent_outdated' })))
    expect((await refusal()).failure).toEqual({ kind: 'consent_outdated' })
  })

  it('lets an abort through as itself, not as a failure', async () => {
    const controller = new AbortController()
    server.use(http.post(ORDERS, () => new Promise<never>(() => undefined)))
    const pending = placeOrder(request, controller.signal)
    controller.abort()
    await expect(pending).rejects.not.toBeInstanceOf(OrderRefused)
  })
})

describe('recoverOrderId (§0.7 step 2)', () => {
  const signal = () => new AbortController().signal

  it('finds the order of the same access once it is consumed', async () => {
    window.history.replaceState(null, '', '/?creation=test')
    vi.stubEnv('VITE_API_MOCKS', '1')
    accessMock.seed('consumed')
    expect(await recoverOrderId('00000000-0000-4000-8000-00000000c001', signal())).toBe('00000000-0000-4000-8000-0000000d0001')
  })

  it('finds nothing for an available access, another access, no session or a failed read', async () => {
    accessMock.seed('available')
    expect(await recoverOrderId(ENTITLEMENT, signal())).toBeNull()
    accessMock.seed('consumed')
    expect(await recoverOrderId(ENTITLEMENT, signal())).toBeNull()
    accessMock.reset()
    expect(await recoverOrderId(ENTITLEMENT, signal())).toBeNull()
    server.use(http.get('/api/v1/session', () => problem(503, { code: 'internal_error' })))
    expect(await recoverOrderId(ENTITLEMENT, signal())).toBeNull()
  })

  it('reads only; it creates nothing', async () => {
    const posts: string[] = []
    server.use(http.post(ORDERS, ({ request: req }) => void posts.push(req.url)))
    accessMock.seed('available')
    await recoverOrderId(ENTITLEMENT, signal())
    expect(posts).toEqual([])
  })
})

describe('loadSetup (§0.3 items 3–5)', () => {
  const signal = () => new AbortController().signal

  it('sends an anonymous visitor back to the access', async () => {
    expect(await loadSetup(signal())).toEqual({ kind: 'signed_out' })
  })

  it('sends a used access to its order', async () => {
    accessMock.seed('consumed')
    expect(await loadSetup(signal())).toEqual({ kind: 'ordered', orderId: '00000000-0000-4000-8000-0000000d0001' })
  })

  it('serves the closed configuration with the session by default', async () => {
    accessMock.seed('available')
    expect(await loadSetup(signal())).toMatchObject({ kind: 'ready', mocked: true, config: { legal_ready: false, consent_version: '' } })
  })

  it('serves the test configuration only for the explicit test mode', async () => {
    window.history.replaceState(null, '', '/?creation=test')
    vi.stubEnv('VITE_API_MOCKS', '1')
    accessMock.seed('available')
    expect(await loadSetup(signal())).toMatchObject({ kind: 'ready', config: { legal_ready: true, consent_version: TEST_CONSENT_VERSION } })
  })

  it('fails closed when the session or the configuration cannot be read', async () => {
    accessMock.seed('available')
    server.use(http.get('/api/v1/session', () => problem(503, { code: 'internal_error' })))
    expect(await loadSetup(signal())).toEqual({ kind: 'failed' })

    server.resetHandlers()
    server.use(http.get('/api/v1/config', () => problem(503, { code: 'internal_error' })))
    expect(await loadSetup(signal())).toEqual({ kind: 'failed' })
  })

  it('still sends an anonymous visitor to the access when the configuration is unreadable', async () => {
    server.use(http.get('/api/v1/config', () => HttpResponse.error()))
    expect(await loadSetup(signal())).toEqual({ kind: 'signed_out' })
  })
})

describe('the access code', () => {
  it('is never part of what this module sends', async () => {
    const seen: string[] = []
    server.use(http.post(ORDERS, async ({ request: req }) => {
      seen.push(req.url, JSON.stringify(Object.fromEntries(req.headers)), await req.clone().text())
      return HttpResponse.json({ id: ORDER, status: 'queued' }, { status: 201 })
    }))

    await placeOrder(request, new AbortController().signal)

    for (const text of seen) expect(text).not.toContain(syntheticCodes.available.slice(3))
  })
})
