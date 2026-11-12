import type { components } from '@/api/schema'

import { places } from './places'

type Schemas = components['schemas']
type Profile = Schemas['Profile']

/**
 * Stand-in for `POST /api/v1/profile-checks` until B1 (SCR-03, slice V2).
 * It repeats the contract's value rules on its own instead of importing the
 * intake validators, so a client-side slip still meets a server «no».
 * Transitions of the clock are not computed: `?profile-check=` forces them.
 */
export type ProfileCheckOutcome =
  | { status: 200; body: Schemas['ProfileCheck'] }
  | { status: 400 | 422; code: Schemas['ErrorCode']; detail: string; fields?: Record<string, string> }

const NAME_MAX = 60
const MIN_YEAR = 1900

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function hasOnlyKeys(value: Record<string, unknown>, required: string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === required.length && required.every((key) => keys.includes(key))
}

/** The request body has the contract's shape; values are judged later. */
function isProfileShape(body: unknown): body is Profile {
  if (!isObject(body) || !hasOnlyKeys(body, ['name', 'birth_date', 'place_id', 'time'])) return false
  if (typeof body.name !== 'string' || typeof body.birth_date !== 'string' || typeof body.place_id !== 'string') return false
  const time = body.time
  if (!isObject(time)) return false
  if (time.kind === 'unknown') return hasOnlyKeys(time, ['kind'])
  if (time.kind !== 'known' || !hasOnlyKeys(time, ['kind', 'value', 'source', 'accuracy_minutes'])) return false
  return typeof time.value === 'string' && typeof time.source === 'string' && typeof time.accuracy_minutes === 'number'
}

function moscowToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function birthDateError(value: string, now: Date): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return 'Дата — в формате ГГГГ-ММ-ДД.'
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return 'Такой даты нет.'
  if (year < MIN_YEAR) return `Год — не раньше ${String(MIN_YEAR)}.`
  if (value > moscowToday(now)) return 'Дата не может быть позже сегодняшней.'
  return null
}

function fieldErrors(profile: Profile, now: Date): Record<string, string> {
  const fields: Record<string, string> = {}
  const nameLength = Array.from(profile.name.trim()).length
  if (nameLength === 0) fields.name = 'Напиши имя — им мы подпишем карту.'
  else if (nameLength > NAME_MAX) fields.name = `Не длиннее ${String(NAME_MAX)} символов.`
  const dateError = birthDateError(profile.birth_date, now)
  if (dateError) fields.birth_date = dateError
  if (profile.time.kind === 'known') {
    const { value, source, accuracy_minutes: accuracy } = profile.time
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fields['time.value'] = 'Укажи время в формате 14:30.'
    if (!['document', 'family', 'approximate'].includes(source)) fields['time.source'] = 'Откуда известно время?'
    if (![0, 15, 30, 60].includes(accuracy)) fields['time.accuracy_minutes'] = 'Погрешность — 0, 15, 30 или 60 минут.'
  }
  return fields
}

export function checkProfile(body: unknown, mode: string | null = null, now: Date = new Date()): ProfileCheckOutcome {
  if (!isProfileShape(body)) return { status: 400, code: 'validation_failed', detail: 'Не удалось прочитать анкету.' }

  const fields = fieldErrors(body, now)
  if (Object.keys(fields).length > 0) return { status: 422, code: 'validation_failed', detail: 'Проверь отмеченные поля.', fields }

  const place = places.find((p) => p.id === body.place_id)
  if (!place) {
    const detail = 'Этого места нет в справочнике. Выбери город заново.'
    return { status: 422, code: 'place_not_found', detail, fields: { place_id: detail } }
  }

  if (body.time.kind === 'known' && mode === 'nonexistent') {
    const detail = 'В этот день часы перевели вперёд — такого времени не было. Проверь время рождения.'
    return { status: 422, code: 'birth_time_nonexistent', detail, fields: { 'time.value': detail } }
  }
  if (body.time.kind === 'known' && mode === 'ambiguous') {
    const detail = 'В этот день часы перевели назад — это время было дважды.'
    return { status: 422, code: 'birth_time_ambiguous', detail, fields: { 'time.value': detail } }
  }

  const profile: Profile = { ...body, name: body.name.trim() }
  return { status: 200, body: { profile, place } }
}
