import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { publicConfig } from '@/mocks/fixtures'
import { server } from '@/mocks/node'

import { createApiClient, fetchConfig } from './client'
import { ApiProblem } from './problem'

describe('fetchConfig', () => {
  it('returns the mocked config and marks it as mocked', async () => {
    const result = await fetchConfig(createApiClient())

    expect(result).toEqual({ config: publicConfig, mocked: true })
  })

  it('turns problem+json into ApiProblem with the stable code', async () => {
    server.use(
      http.get('/api/v1/config', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'internal_error', detail: 'Сбой', request_id: 'r1' },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    )

    const err = await fetchConfig(createApiClient()).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiProblem)
    expect(err).toMatchObject({ status: 500, code: 'internal_error', detail: 'Сбой', requestId: 'r1' })
  })

  it('reports a non-problem error body as unexpected_response', async () => {
    server.use(http.get('/api/v1/config', () => new HttpResponse('bad gateway', { status: 502 })))

    const err = await fetchConfig(createApiClient()).catch((e: unknown) => e)

    expect(err).toMatchObject({ status: 502, code: 'unexpected_response' })
  })

  it('reports transport failures as network', async () => {
    server.use(http.get('/api/v1/config', () => HttpResponse.error()))

    const err = await fetchConfig(createApiClient()).catch((e: unknown) => e)

    expect(err).toMatchObject({ status: 0, code: 'network' })
  })
})
