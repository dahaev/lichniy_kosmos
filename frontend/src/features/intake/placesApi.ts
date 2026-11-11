import { createApiClient, type ApiClient } from '@/api/client'
import { ApiProblem } from '@/api/problem'
import type { components } from '@/api/schema'

export type Place = components['schemas']['Place']

export const PLACE_QUERY_MIN = 2

/** «Казань · Республика Татарстан · Россия» — how a place is shown everywhere. */
export function placeLabel(place: { name: string; region?: string | undefined; country: string }): string {
  return [place.name, place.region, place.country].filter(Boolean).join(' · ')
}

/**
 * GET /api/v1/places?q= (ARCHITECTURE_MVP_v2 §15.2). Aborting is not a
 * failure: the caller started a newer search and ignores this one.
 */
export async function searchPlaces(query: string, signal: AbortSignal, client: ApiClient = createApiClient()): Promise<Place[]> {
  let result
  try {
    result = await client.GET('/api/v1/places', { params: { query: { q: query } }, signal })
  } catch (cause) {
    if (signal.aborted) throw cause
    throw ApiProblem.network(cause)
  }
  const { data, error, response } = result
  if (data) return data.items
  throw ApiProblem.fromResponse(response.status, error)
}
