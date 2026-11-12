import { describe, expect, it } from 'vitest'

import { ApiProblem } from '@/api/problem'

import { emptyDraft, type IntakeDraft } from './draft'
import { CHECK_FAILED_MESSAGE, checkFailure, fieldStep, invalidSteps, requestProfileCheck, reviewItems, toProfile, type Profile } from './review'

function completeDraft(patch: Partial<IntakeDraft> = {}): IntakeDraft {
  return {
    ...emptyDraft(),
    step: 'time',
    name: '  Тестовая Вега  ',
    date: { day: '7', month: '3', year: '1990' },
    place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
    time: { kind: 'known', hhmm: '930', source: 'family', accuracy: null, accuracyTouched: false },
    ...patch,
  }
}

const kazan = { name: 'Казань', region: 'Республика Татарстан', country: 'Россия' }

describe('toProfile', () => {
  it('writes the draft in the contract shape: trimmed name, padded date, normalized time', () => {
    expect(toProfile(completeDraft())).toEqual({
      name: 'Тестовая Вега',
      birth_date: '1990-03-07',
      place_id: 'ru-kzn',
      time: { kind: 'known', value: '09:30', source: 'family', accuracy_minutes: 15 },
    })
  })

  it('keeps an accuracy the visitor chose', () => {
    const draft = completeDraft({ time: { kind: 'known', hhmm: '14:30', source: 'document', accuracy: 30, accuracyTouched: true } })
    expect(toProfile(draft)?.time).toEqual({ kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 30 })
  })

  it('sends only the kind for an unknown time (Р3)', () => {
    const draft = completeDraft({ time: { kind: 'unknown', hhmm: '', source: 'unknown', accuracy: 0, accuracyTouched: false } })
    expect(toProfile(draft)?.time).toEqual({ kind: 'unknown' })
  })

  it.each<[string, Partial<IntakeDraft>]>([
    ['an empty name', { name: '   ' }],
    ['an impossible date', { date: { day: '30', month: '2', year: '1990' } }],
    ['no chosen place', { place: { query: 'Каз', selected: null } }],
    ['no time answer', { time: { kind: null, hhmm: '', source: null, accuracy: null, accuracyTouched: false } }],
    ['a known time without a source', { time: { kind: 'known', hhmm: '14:30', source: null, accuracy: null, accuracyTouched: false } }],
  ])('is null with %s', (_, patch) => {
    expect(toProfile(completeDraft(patch))).toBeNull()
  })
})

describe('reviewItems', () => {
  const profile = toProfile(completeDraft()) as Profile

  it('lists the four answers in intake order with their notes', () => {
    expect(reviewItems(profile, kazan).map(({ step, label, value, note }) => ({ step, label, value, note }))).toEqual([
      { step: 'name', label: 'Имя', value: 'Тестовая Вега', note: 'Так будет подписана карта.' },
      { step: 'date', label: 'Дата рождения', value: '7 марта 1990', note: 'среда' },
      { step: 'place', label: 'Место рождения', value: 'Казань', note: 'Республика Татарстан · Россия' },
      { step: 'time', label: 'Время рождения', value: '09:30', note: 'Со слов родных, ±15 мин' },
    ])
  })

  it('names «Изменить» after its block, starting with the visible word', () => {
    expect(reviewItems(profile, kazan).map((item) => item.editLabel)).toEqual([
      'Изменить имя',
      'Изменить дату рождения',
      'Изменить место рождения',
      'Изменить время рождения',
    ])
  })

  it('says what an unknown time leaves out of the chart', () => {
    const time = reviewItems({ ...profile, time: { kind: 'unknown' } }, kazan)[3]
    expect(time).toMatchObject({ value: 'Неизвестно', note: 'Карта будет построена без домов и асцендента.' })
  })

  it('shows a place without a region by its country only', () => {
    expect(reviewItems(profile, { name: 'Минск', country: 'Беларусь' })[2]?.note).toBe('Беларусь')
  })
})

describe('server answer', () => {
  it.each([
    ['name', 'name'],
    ['birth_date', 'date'],
    ['place_id', 'place'],
    ['time.value', 'time'],
    ['time.accuracy_minutes', 'time'],
    ['unknown', null],
  ])('maps field %s to step %s', (path, step) => {
    expect(fieldStep(path)).toBe(step)
  })

  it('turns a 422 with fields into errors per block, joining two time messages', () => {
    const problem = new ApiProblem(422, 'validation_failed', 'Проверь отмеченные поля.', undefined, {
      fields: { birth_date: 'Такой даты нет.', 'time.value': 'Укажи время.', 'time.source': 'Откуда известно время?' },
    })
    const failure = checkFailure(problem)

    expect(failure).toEqual({ kind: 'invalid', errors: { date: 'Такой даты нет.', time: 'Укажи время. Откуда известно время?' } })
    expect(failure.kind === 'invalid' && invalidSteps(failure.errors)).toEqual(['date', 'time'])
  })

  it('treats the ambiguous time as an error of the time block, with no choice offered (Р7)', () => {
    const problem = new ApiProblem(422, 'birth_time_ambiguous', 'Это время было дважды.', undefined, { fields: { 'time.value': 'Это время было дважды.' } })
    expect(checkFailure(problem)).toEqual({ kind: 'invalid', errors: { time: 'Это время было дважды.' } })
  })

  it.each([
    ['rate limit with its own text', new ApiProblem(429, 'rate_limited', 'Подожди минуту.'), 'Подожди минуту.'],
    ['server failure', new ApiProblem(503, 'internal_error'), CHECK_FAILED_MESSAGE],
    ['network', ApiProblem.network(new TypeError('offline')), CHECK_FAILED_MESSAGE],
    ['unreadable body', new ApiProblem(400, 'validation_failed'), CHECK_FAILED_MESSAGE],
    ['422 with no known field', new ApiProblem(422, 'validation_failed', undefined, undefined, { fields: { other: 'x' } }), CHECK_FAILED_MESSAGE],
  ])('offers a retry after a %s', (_, problem, message) => {
    expect(checkFailure(problem)).toEqual({ kind: 'failed', message })
  })
})

describe('requestProfileCheck', () => {
  const profile = toProfile(completeDraft()) as Profile

  it('returns the checked profile and place from the mock', async () => {
    const result = await requestProfileCheck(profile, new AbortController().signal)

    expect(result.profile).toEqual(profile)
    expect(result.place).toMatchObject({ id: 'ru-kzn', name: 'Казань' })
  })

  it('throws the problem with its fields', async () => {
    const error = await requestProfileCheck({ ...profile, place_id: 'xx-none' }, new AbortController().signal).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiProblem)
    expect(error).toMatchObject({ status: 422, code: 'place_not_found', fields: { place_id: expect.any(String) as string } })
  })
})
