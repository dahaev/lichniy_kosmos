import { createApiClient, type ApiClient } from '@/api/client'
import { ApiProblem } from '@/api/problem'
import type { components } from '@/api/schema'

import type { IntakeDraft } from './draft'
import { intakeSteps, type IntakeStep } from './steps'
import { accuracyBySource, formatDate, normalizeTime, validateDate, type TimeAccuracy, type TimeSource } from './validation'

// SCR-03: the review of the four answers and its server check
// (POST /api/v1/profile-checks, SCR-03 §0.2). Pure functions, so the view
// only wires state, focus and motion.

export type Profile = components['schemas']['Profile']
export type ProfileCheck = components['schemas']['ProfileCheck']

/** The draft as the contract's Profile; null while any answer is missing or invalid. */
export function toProfile(draft: IntakeDraft): Profile | null {
  const { date } = validateDate(draft.date)
  const place = draft.place.selected
  const name = draft.name.trim()
  if (!date || !place || !name || draft.time.kind === null) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = { name, birth_date: `${String(date.year)}-${pad(date.month)}-${pad(date.day)}`, place_id: place.id }
  if (draft.time.kind === 'unknown') return { ...base, time: { kind: 'unknown' } }
  const value = normalizeTime(draft.time.hhmm)
  const source = draft.time.source
  if (!value || source === null || source === 'unknown') return null
  return { ...base, time: { kind: 'known', value, source, accuracy_minutes: draft.time.accuracy ?? accuracyBySource[source] } }
}

export interface ReviewItem {
  step: IntakeStep
  label: string
  /** Accessible name of «Изменить»; starts with the visible text (WCAG 2.5.3). */
  editLabel: string
  value: string
  note: string
}

const sourceLabels: Record<Exclude<TimeSource, 'unknown'>, string> = {
  document: 'По документу',
  family: 'Со слов родных',
  approximate: 'Примерно',
}

const accuracyLabels: Record<TimeAccuracy, string> = { 0: 'до минуты', 15: '±15 мин', 30: '±30 мин', 60: '±1 час' }

const items: Record<IntakeStep, { label: string; subject: string }> = {
  name: { label: 'Имя', subject: 'имя' },
  date: { label: 'Дата рождения', subject: 'дату рождения' },
  place: { label: 'Место рождения', subject: 'место рождения' },
  time: { label: 'Время рождения', subject: 'время рождения' },
}

/** How the summary names a block in «Нужно поправить: …». */
export const blockNames: Record<IntakeStep, string> = {
  name: 'имя',
  date: 'дата рождения',
  place: 'место рождения',
  time: 'время рождения',
}

function item(step: IntakeStep, value: string, note: string): ReviewItem {
  const { label, subject } = items[step]
  return { step, label, editLabel: `Изменить ${subject}`, value, note }
}

/**
 * The four blocks, written from the profile the request carries; the place
 * comes from the server once it has answered (SCR-03 §0.9).
 */
export function reviewItems(profile: Profile, place: { name: string; region?: string | undefined; country: string }): ReviewItem[] {
  const [year, month, day] = profile.birth_date.split('-').map(Number) as [number, number, number]
  const spelled = formatDate({ year, month, day })
  const comma = spelled.lastIndexOf(', ')
  const time =
    profile.time.kind === 'unknown'
      ? item('time', 'Неизвестно', 'Карта будет построена без домов и асцендента.')
      : item('time', profile.time.value, `${sourceLabels[profile.time.source]}, ${accuracyLabels[profile.time.accuracy_minutes]}`)
  return [
    item('name', profile.name, 'Так будет подписана карта.'),
    item('date', spelled.slice(0, comma), spelled.slice(comma + 2)),
    item('place', place.name, [place.region, place.country].filter(Boolean).join(' · ')),
    time,
  ]
}

/** Which step answers a field path of the contract (`time.value` → time). */
export function fieldStep(path: string): IntakeStep | null {
  const head = path.split('.')[0]
  if (head === 'name') return 'name'
  if (head === 'birth_date') return 'date'
  if (head === 'place_id') return 'place'
  if (head === 'time') return 'time'
  return null
}

export type CheckFailure =
  | { kind: 'invalid'; errors: Partial<Record<IntakeStep, string>> }
  | { kind: 'failed'; message: string }

export const CHECK_FAILED_MESSAGE = 'Не удалось проверить данные. Проверь соединение и попробуй ещё раз.'

/**
 * A 422 with fields is the visitor's to fix at a step; anything else —
 * 400, 429, 5xx, network — is a failed check to retry (SCR-03 §0.3, Р6).
 */
export function checkFailure(problem: ApiProblem): CheckFailure {
  if (problem.status === 422 && problem.fields) {
    const errors: Partial<Record<IntakeStep, string>> = {}
    for (const [path, message] of Object.entries(problem.fields)) {
      const step = fieldStep(path)
      if (step) errors[step] = errors[step] ? `${errors[step]} ${message}` : message
    }
    if (Object.keys(errors).length > 0) return { kind: 'invalid', errors }
  }
  return { kind: 'failed', message: problem.detail ?? CHECK_FAILED_MESSAGE }
}

/** Steps with errors in the order of the intake, for the summary line. */
export function invalidSteps(errors: Partial<Record<IntakeStep, string>>): IntakeStep[] {
  return intakeSteps.filter((step) => errors[step])
}

/** POST /api/v1/profile-checks. Aborting is not a failure: the review left or started a newer check. */
export async function requestProfileCheck(profile: Profile, signal: AbortSignal, client: ApiClient = createApiClient()): Promise<ProfileCheck> {
  let result
  try {
    result = await client.POST('/api/v1/profile-checks', { body: profile, signal })
  } catch (cause) {
    if (signal.aborted) throw cause
    throw ApiProblem.network(cause)
  }
  const { data, error, response } = result
  if (data) return data
  throw ApiProblem.fromResponse(response.status, error)
}
