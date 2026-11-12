import { delay, http, HttpResponse } from 'msw'

import { MOCK_HEADER } from '@/api/client'
import type { components } from '@/api/schema'

import { accessDetails, createAccessMock } from './access'
import { publicConfig } from './fixtures'
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

const statusTitles: Record<number, string> = {
  400: 'Bad Request',
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

  http.get('/api/v1/config', () => HttpResponse.json<Schemas['PublicConfig']>(publicConfig, { headers: mockHeaders })),

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
]
