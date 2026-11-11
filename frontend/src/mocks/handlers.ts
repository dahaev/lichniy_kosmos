import { delay, http, HttpResponse } from 'msw'

import { MOCK_HEADER } from '@/api/client'
import type { components } from '@/api/schema'

import { publicConfig } from './fixtures'
import { places, searchPlaces } from './places'

type Schemas = components['schemas']

const mockHeaders = { [MOCK_HEADER]: '1' }

/**
 * Dev switch for the city search states (SCR-02 §0.5): `?places=slow`,
 * `?places=empty` or `?places=error` on the page URL.
 */
function placesMode(): string | null {
  return new URLSearchParams(globalThis.location.search).get('places')
}

function problem(status: number, code: Schemas['ErrorCode'], title: string) {
  return HttpResponse.json<Schemas['Problem']>(
    { type: 'about:blank', title, status, code },
    { status, headers: { ...mockHeaders, 'content-type': 'application/problem+json' } },
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
    if (mode === 'error') return problem(503, 'internal_error', 'Service Unavailable')
    const q = new URL(request.url).searchParams.get('q') ?? ''
    if (q.trim().length < 2) return problem(400, 'validation_failed', 'Bad Request')
    const items = mode === 'empty' ? [] : searchPlaces(q)
    return HttpResponse.json<Schemas['PlaceList']>({ items }, { headers: mockHeaders })
  }),

  http.get<{ id: string }, never, Schemas['Place'] | Schemas['Problem']>('/api/v1/places/:id', ({ params }) => {
    const place = places.find((p) => p.id === params.id)
    if (!place) return problem(404, 'place_not_found', 'Not Found')
    return HttpResponse.json<Schemas['Place']>(place, { headers: mockHeaders })
  }),
]
