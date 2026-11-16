import { delay, http, HttpResponse } from 'msw'

import { MOCK_HEADER } from '@/api/client'
import type { components } from '@/api/schema'

import { accessDetails, createAccessMock } from './access'
import { isChartFixtureName } from './chartFixtures'
import { publicConfig, testCreationConfig } from './fixtures'
import { createOrderReadsMock, type ReadOutcome, type ReadScenario } from './orderReads'
import { nextHappyState, parseState } from './orderStates'
import { createOrdersMock, type OrdersFault, type OrdersScenario } from './orders'
import { places, searchPlaces } from './places'
import { checkProfile } from './profileChecks'

type Schemas = components['schemas']

const mockHeaders = { [MOCK_HEADER]: '1' }

/** Dev switches on the page URL, e.g. `?places=slow` or `?profile-check=ambiguous`. */
function devMode(name: string): string | null {
  return new URLSearchParams(globalThis.location.search).get(name)
}

/**
 * City search states (SCR-02 §0.5): `?places=slow`, `?places=empty` or
 * `?places=error`.
 */
function placesMode(): string | null {
  return devMode('places')
}

/**
 * Review check states (SCR-03 §0.5): `?profile-check=slow`, `error`,
 * `rate-limited`, `nonexistent` or `ambiguous`.
 */
function profileCheckMode(): string | null {
  return devMode('profile-check')
}

/**
 * Session and code login states (SCR-04 §0.3): `?session=code-available`,
 * `code-consumed`, `slow` or `error`; `?auth-code=slow`, `error` or
 * `rate-limited`. Codes themselves pick the other states (`access.ts`).
 */
function sessionMode(): string | null {
  return devMode('session')
}

function authCodeMode(): string | null {
  return devMode('auth-code')
}

/** One mock browser session for the whole page; tests call `accessMock.reset()`. */
export const accessMock = createAccessMock()
let sessionSeeded = false

function seedSession(): void {
  if (sessionSeeded) return
  sessionSeeded = true
  const mode = sessionMode()
  if (mode === 'code-available') accessMock.seed('available')
  if (mode === 'code-consumed') accessMock.seed('consumed')
}

/**
 * The explicit test mode of order creation (SCR-05 К6, К8): the owner tries
 * the screen on mocks. It needs all three: a dev build, MSW switched on and
 * `?creation=test` on the page. `import.meta.env.DEV` is a compile-time
 * constant, and production never bundles this file (`main.ts` imports the
 * mocks only under the same check), so the production path cannot reach it.
 */
export function creationTestMode(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_API_MOCKS === '1' && devMode('creation') === 'test'
}

/**
 * The configuration the mock server reports. Closed (`legal_ready=false`) in
 * every mode but the explicit test mode.
 */
export function currentConfig(): Schemas['PublicConfig'] {
  return creationTestMode() ? testCreationConfig(ordersMock.consentVersion()) : publicConfig
}

/**
 * Order creation states (SCR-05 §0.4, §0.8): `?orders=slow`, `error`
 * (503, nothing created), `timeout` (created, the answer is lost),
 * `drop` (the request is lost, nothing created), `error-after` (created, 503),
 * `rate-limited`, `consent-outdated`, `blocked`, `used`, `calculation-failed`,
 * `nonexistent` or `ambiguous`. Faults happen once, so a retry can recover.
 */
function ordersMode(): string | null {
  return devMode('orders')
}

const faultModes: Record<string, OrdersFault> = {
  timeout: 'lost-response',
  drop: 'lost-request',
  'error-after': 'error-after-commit',
}

const scenarioModes: OrdersScenario[] = ['rate-limited', 'consent-outdated', 'blocked', 'used', 'calculation-failed', 'nonexistent', 'ambiguous']

function orderScenario(mode: string | null): OrdersScenario | null {
  return scenarioModes.find((scenario) => scenario === mode) ?? null
}

/**
 * Order reading (SCR-06 §0.4). It is its own right, apart from creating: the
 * gate above does not reach it. Dev switches on the page URL:
 * `?order-state=<state>` (`queued`, `writing`, `illustrating`, `ready`,
 * `failed_retryable[:reading|:illustration]`, `needs_review:paused|review`
 * with the same suffixes) and `?order-chart=<known|range|unknown|polar|stellium>`
 * give an order its state and synthetic chart; `?order-flow=auto` moves it one
 * step along the happy path every third read; `?order-read=slow|error|rate-limited`
 * spoils the read itself.
 */
export const orderReadsMock = createOrderReadsMock(accessMock)

function devOrderState() {
  return parseState(devMode('order-state')) ?? undefined
}

function devOrderChart() {
  const name = devMode('order-chart')
  return isChartFixtureName(name) ? name : undefined
}

/** One mock server for the page: the gate reads the configuration it serves. */
export const ordersMock = createOrdersMock(
  accessMock,
  () => {
    const { legal_ready: legalReady, features } = currentConfig()
    return { legalReady, generation: features.generation }
  },
  {
    created: ({ id, entitlementId, profile, place }) => {
      const state = devOrderState()
      const chart = devOrderChart()
      orderReadsMock.register({ id, entitlementId, profile, place, ...(state ? { state } : {}), ...(chart ? { chart } : {}) })
    },
  },
)

/** `?session=code-consumed` has an order id but no order behind it: give it one when a dev switch asks. */
function seedDevOrder(): void {
  const access = accessMock.readAccess()
  if (!access?.orderId || orderReadsMock.has(access.orderId)) return
  const state = devOrderState()
  const chart = devOrderChart()
  if (!state && !chart) return
  orderReadsMock.register({ id: access.orderId, entitlementId: access.entitlementId, ...(state ? { state } : {}), ...(chart ? { chart } : {}) })
}

const flowReads = new Map<string, number>()

function advanceDevFlow(id: string): void {
  if (devMode('order-flow') !== 'auto') return
  const reads = (flowReads.get(id) ?? 0) + 1
  flowReads.set(id, reads)
  if (reads % 3 !== 0) return
  const state = orderReadsMock.stateOf(id)
  const next = state ? nextHappyState(state) : null
  if (next) orderReadsMock.advance(id, next)
}

function orderReadMode(): string | null {
  return devMode('order-read')
}

/** Both read endpoints answer the same way: `200`/`304` with the cache headers, or a problem. */
function readResponse<T extends object>(outcome: ReadOutcome<T>) {
  if ('etag' in outcome) {
    const headers = { ...mockHeaders, ETag: outcome.etag, 'Cache-Control': 'no-store', Vary: 'Cookie' }
    if (outcome.status === 304) return new HttpResponse(null, { status: 304, headers })
    return HttpResponse.json<T>(outcome.body, { status: 200, headers })
  }
  const headers = outcome.retryAfter ? { 'retry-after': String(outcome.retryAfter) } : {}
  return problem(outcome.status, outcome.code, { detail: outcome.detail }, headers)
}
let devFaultArmed = false

function armDevFault(): void {
  const fault = faultModes[ordersMode() ?? '']
  if (devFaultArmed || !fault) return
  devFaultArmed = true
  ordersMock.inject(fault)
}

const statusTitles: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
}

function problem(
  status: number,
  code: Schemas['ErrorCode'],
  extra: Pick<Schemas['Problem'], 'detail' | 'fields'> = {},
  headers: Record<string, string> = {},
) {
  return HttpResponse.json<Schemas['Problem']>(
    { type: 'about:blank', title: statusTitles[status] ?? 'Error', status, code, ...extra },
    { status, headers: { ...mockHeaders, ...headers, 'content-type': 'application/problem+json' } },
  )
}

/**
 * MSW handlers mirror api/openapi.yaml: response bodies are typed from the
 * generated schema, so contract drift fails `vue-tsc`. A path is added to the
 * contract first, then mocked here (ARCHITECTURE_MVP_v2 §16.6).
 */
export const handlers = [
  http.get('/healthz', () => HttpResponse.json<Schemas['Health']>({ status: 'ok' }, { headers: mockHeaders })),

  http.get('/readyz', () =>
    HttpResponse.json<Schemas['Readiness']>(
      { status: 'ready', checks: { postgres: 'ok', migrations: 'ok' } },
      { headers: mockHeaders },
    ),
  ),

  http.get('/api/v1/config', () => HttpResponse.json<Schemas['PublicConfig']>(currentConfig(), { headers: mockHeaders })),

  http.get<never, never, Schemas['PlaceList'] | Schemas['Problem']>('/api/v1/places', async ({ request }) => {
    const mode = placesMode()
    // A realistic network: slow enough to see «Ищем…» only when asked.
    await delay(mode === 'slow' ? 1500 : 120)
    if (mode === 'error') return problem(503, 'internal_error')
    const q = new URL(request.url).searchParams.get('q') ?? ''
    if (q.trim().length < 2) return problem(400, 'validation_failed')
    const items = mode === 'empty' ? [] : searchPlaces(q)
    return HttpResponse.json<Schemas['PlaceList']>({ items }, { headers: mockHeaders })
  }),

  http.get<{ id: string }, never, Schemas['Place'] | Schemas['Problem']>('/api/v1/places/:id', ({ params }) => {
    const place = places.find((p) => p.id === params.id)
    if (!place) return problem(404, 'place_not_found')
    return HttpResponse.json<Schemas['Place']>(place, { headers: mockHeaders })
  }),

  http.post<never, never, Schemas['ProfileCheck'] | Schemas['Problem']>('/api/v1/profile-checks', async ({ request }) => {
    const mode = profileCheckMode()
    await delay(mode === 'slow' ? 1500 : 150)
    if (mode === 'error') return problem(503, 'internal_error')
    if (mode === 'rate-limited') return problem(429, 'rate_limited', { detail: 'Слишком много проверок подряд. Подожди минуту и попробуй снова.' })
    let body: unknown
    try {
      body = await request.json()
    } catch {
      body = undefined
    }
    const outcome = checkProfile(body, mode)
    if (outcome.status === 200) return HttpResponse.json<Schemas['ProfileCheck']>(outcome.body, { headers: mockHeaders })
    return problem(outcome.status, outcome.code, { detail: outcome.detail, ...(outcome.fields ? { fields: outcome.fields } : {}) })
  }),

  http.get<never, never, Schemas['Session'] | Schemas['Problem']>('/api/v1/session', async () => {
    seedSession()
    const mode = sessionMode()
    await delay(mode === 'slow' ? 1500 : 80)
    if (mode === 'error') return problem(503, 'internal_error')
    return HttpResponse.json<Schemas['Session']>(accessMock.session(), { headers: mockHeaders })
  }),

  http.post<never, never, Schemas['CodeSession'] | Schemas['Problem']>('/api/v1/auth/code', async ({ request }) => {
    seedSession()
    const mode = authCodeMode()
    await delay(mode === 'slow' ? 1500 : 150)
    if (mode === 'error') return problem(503, 'internal_error')
    if (mode === 'rate-limited') return problem(429, 'rate_limited', { detail: accessDetails.rateLimited }, { 'retry-after': '60' })
    let body: unknown
    try {
      body = await request.json()
    } catch {
      body = undefined
    }
    const outcome = accessMock.login(body)
    if (outcome.status === 200) return HttpResponse.json<Schemas['CodeSession']>(outcome.body, { headers: mockHeaders })
    const headers = outcome.retryAfter ? { 'retry-after': String(outcome.retryAfter) } : {}
    return problem(outcome.status, outcome.code, { detail: outcome.detail }, headers)
  }),

  http.post<never, never, Schemas['OrderCreated'] | Schemas['Problem']>('/api/v1/orders', async ({ request }) => {
    seedSession()
    armDevFault()
    const mode = ordersMode()
    await delay(mode === 'slow' ? 1500 : 150)
    if (mode === 'error') return problem(503, 'internal_error')
    // The request never reached the server: nothing is created, the client sees a network error.
    const fault = ordersMock.takeFault()
    if (fault === 'lost-request') return HttpResponse.error()
    let body: unknown
    try {
      body = await request.json()
    } catch {
      body = undefined
    }
    const outcome = ordersMock.create({ key: request.headers.get('idempotency-key'), body, scenario: orderScenario(mode) })
    // The server decided and committed; the answer does not reach the client.
    if (fault === 'lost-response') return HttpResponse.error()
    if (fault === 'error-after-commit') return problem(503, 'internal_error')
    if ('body' in outcome) {
      return HttpResponse.json<Schemas['OrderCreated']>(outcome.body, { status: outcome.status, headers: mockHeaders })
    }
    const headers = outcome.retryAfter ? { 'retry-after': String(outcome.retryAfter) } : {}
    return problem(outcome.status, outcome.code, { detail: outcome.detail, ...(outcome.fields ? { fields: outcome.fields } : {}) }, headers)
  }),

  http.get<{ id: string }>('/api/v1/orders/:id', async ({ request, params }) => {
    seedSession()
    seedDevOrder()
    const mode = orderReadMode()
    await delay(mode === 'slow' ? 1500 : 80)
    if (mode === 'error') return problem(503, 'internal_error')
    advanceDevFlow(params.id)
    const scenario: ReadScenario | null = mode === 'rate-limited' ? 'rate-limited' : null
    return readResponse(orderReadsMock.read({ id: params.id, ifNoneMatch: request.headers.get('if-none-match'), scenario }))
  }),

  http.get<{ id: string }>('/api/v1/orders/:id/reading', async ({ request, params }) => {
    seedSession()
    seedDevOrder()
    const mode = orderReadMode()
    await delay(mode === 'slow' ? 1500 : 80)
    if (mode === 'error') return problem(503, 'internal_error')
    const scenario: ReadScenario | null = mode === 'rate-limited' ? 'rate-limited' : null
    return readResponse(orderReadsMock.readReading({ id: params.id, ifNoneMatch: request.headers.get('if-none-match'), scenario }))
  }),
]
