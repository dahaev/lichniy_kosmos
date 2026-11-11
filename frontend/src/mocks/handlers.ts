import { http, HttpResponse } from 'msw'

import { MOCK_HEADER } from '@/api/client'
import type { components } from '@/api/schema'

import { publicConfig } from './fixtures'

type Schemas = components['schemas']

const mockHeaders = { [MOCK_HEADER]: '1' }

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
]
