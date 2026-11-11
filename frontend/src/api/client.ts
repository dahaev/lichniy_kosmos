import createClient from 'openapi-fetch'

import { ApiProblem } from './problem'
import type { components, paths } from './schema'

export type PublicConfig = components['schemas']['PublicConfig']

/** Set by MSW handlers so dev tooling can show where data came from. */
export const MOCK_HEADER = 'x-cosmos-mock'

export type ApiClient = ReturnType<typeof createApiClient>

export function createApiClient(baseUrl: string = globalThis.location.origin) {
  return createClient<paths>({ baseUrl })
}

export interface ConfigResult {
  config: PublicConfig
  mocked: boolean
}

export async function fetchConfig(client: ApiClient): Promise<ConfigResult> {
  let result
  try {
    result = await client.GET('/api/v1/config')
  } catch (cause) {
    throw ApiProblem.network(cause)
  }
  const { data, error, response } = result
  if (data) {
    return { config: data, mocked: response.headers.get(MOCK_HEADER) === '1' }
  }
  throw ApiProblem.fromResponse(response.status, error)
}
