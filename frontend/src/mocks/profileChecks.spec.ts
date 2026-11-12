import { describe, expect, it } from 'vitest'

import type { components } from '@/api/schema'

import { checkProfile } from './profileChecks'

type Profile = components['schemas']['Profile']

const now = new Date('2026-11-12T09:00:00Z')

const known: Profile = {
  name: '  Тестовая Вега  ',
  birth_date: '1990-03-12',
  place_id: 'ru-kzn',
  time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 },
}

const unknownTime: Profile = { ...known, time: { kind: 'unknown' } }

describe('checkProfile mock', () => {
  it('returns the trimmed profile with its place', () => {
    const outcome = checkProfile(known, null, now)

    expect(outcome.status).toBe(200)
    if (outcome.status !== 200) return
    expect(outcome.body.profile).toEqual({ ...known, name: 'Тестовая Вега' })
    expect(outcome.body.place).toMatchObject({ id: 'ru-kzn', name: 'Казань', timezone: 'Europe/Moscow' })
  })

  it('accepts an unknown time without source or accuracy', () => {
    expect(checkProfile(unknownTime, null, now).status).toBe(200)
  })

  it.each([
    ['not an object', 'text'],
    ['an unknown field', { ...known, city: 'Казань' }],
    ['a missing field', { name: 'Вега', birth_date: '1990-03-12', time: { kind: 'unknown' } }],
    ['extra keys on an unknown time', { ...known, time: { kind: 'unknown', value: '14:30' } }],
    ['a wrong type', { ...known, time: { ...known.time, accuracy_minutes: '15' } }],
  ])('rejects %s as an unreadable body', (_, body) => {
    expect(checkProfile(body, null, now)).toMatchObject({ status: 400, code: 'validation_failed' })
  })

  it('names every broken field at once', () => {
    const outcome = checkProfile(
      { ...known, name: '   ', birth_date: '1990-02-30', time: { kind: 'known', value: '24:00', source: 'unknown', accuracy_minutes: 5 } },
      null,
      now,
    )

    expect(outcome).toMatchObject({ status: 422, code: 'validation_failed' })
    expect(Object.keys(outcome.status === 422 ? (outcome.fields ?? {}) : {}).sort()).toEqual([
      'birth_date',
      'name',
      'time.accuracy_minutes',
      'time.source',
      'time.value',
    ])
  })

  it.each([
    ['61 characters', { name: 'а'.repeat(61) }, 'name'],
    ['a date before 1900', { birth_date: '1899-12-31' }, 'birth_date'],
    ['a date after today in Moscow', { birth_date: '2026-11-13' }, 'birth_date'],
  ])('rejects %s', (_, patch, field) => {
    const outcome = checkProfile({ ...known, ...patch }, null, now)

    expect(outcome).toMatchObject({ status: 422, code: 'validation_failed', fields: { [field]: expect.any(String) as string } })
  })

  it('counts code points, so 60 emoji are still a valid name', () => {
    expect(checkProfile({ ...known, name: '🌙'.repeat(60) }, null, now).status).toBe(200)
  })

  it('reports a place missing from the gazetteer on place_id', () => {
    expect(checkProfile({ ...known, place_id: 'xx-none' }, null, now)).toMatchObject({
      status: 422,
      code: 'place_not_found',
      fields: { place_id: expect.any(String) as string },
    })
  })

  it.each(['nonexistent', 'ambiguous'] as const)('forces a %s local time on time.value', (mode) => {
    expect(checkProfile(known, mode, now)).toMatchObject({
      status: 422,
      code: `birth_time_${mode}`,
      fields: { 'time.value': expect.any(String) as string },
    })
  })

  it('ignores the clock switches when the time is unknown', () => {
    expect(checkProfile(unknownTime, 'ambiguous', now).status).toBe(200)
  })
})

describe('POST /api/v1/profile-checks handler', () => {
  const post = (body: string) =>
    fetch(new URL('/api/v1/profile-checks', globalThis.location.origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })

  it('answers a valid profile with 200', async () => {
    const response = await post(JSON.stringify(unknownTime))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ profile: { name: 'Тестовая Вега' }, place: { id: 'ru-kzn' } })
  })

  it('answers field errors with problem+json', async () => {
    const response = await post(JSON.stringify({ ...unknownTime, name: '' }))

    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toMatchObject({ status: 422, code: 'validation_failed', fields: { name: expect.any(String) as string } })
  })

  it('answers a body that is not JSON with 400', async () => {
    const response = await post('{')

    expect(response.status).toBe(400)
  })
})
