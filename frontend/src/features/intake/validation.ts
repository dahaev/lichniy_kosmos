// Field rules of SCR-02 §0.5. Pure functions: the same checks run on «Далее»,
// on re-validation while typing and when a reload decides which step is open.
// The server repeats them in profile-checks; these only spare a round trip.

export const NAME_MAX = 60
export const MIN_YEAR = 1900

export interface CalendarDate {
  year: number
  month: number
  day: number
}

export interface DateParts {
  day: string
  month: string
  year: string
}

export type TimeKind = 'known' | 'unknown'
export type TimeSource = 'document' | 'family' | 'approximate' | 'unknown'
export type TimeAccuracy = 0 | 15 | 30 | 60

export interface TimeAnswer {
  kind: TimeKind | null
  hhmm: string
  source: TimeSource | null
  accuracy: TimeAccuracy | null
}

/** Code points, not UTF-16 units: an emoji counts once. */
export function nameLength(value: string): number {
  return Array.from(value.trim()).length
}

export function validateName(value: string): string | null {
  const length = nameLength(value)
  if (length === 0) return 'Напиши имя — им мы подпишем карту.'
  if (length > NAME_MAX) return `Не длиннее ${String(NAME_MAX)} символов.`
  return null
}

/** «Today» for the not-in-the-future rule is the Moscow date (ARCHITECTURE §7.1). */
export function moscowToday(now: Date = new Date()): CalendarDate {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('-')
    .map(Number)
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

const monthsPrepositional = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

function daysWord(n: number): string {
  const last = n % 10
  if (last === 1 && n % 100 !== 11) return 'день'
  if (last >= 2 && last <= 4 && (n % 100 < 12 || n % 100 > 14)) return 'дня'
  return 'дней'
}

export type DateResult = { date: CalendarDate; error: null } | { date: null; error: string }

export function validateDate(parts: DateParts, today: CalendarDate = moscowToday()): DateResult {
  const fail = (error: string): DateResult => ({ date: null, error })
  const [day, month, year] = [parts.day, parts.month, parts.year].map((part) => part.trim())
  if (!day || !month || !year) return fail('Укажи день, месяц и год.')
  if (![day, month, year].every((part) => /^\d+$/.test(part))) return fail('Только цифры: например, 12 03 1990.')
  if (year.length !== 4) return fail('Год — четыре цифры, например 1990.')
  const date = { day: Number(day), month: Number(month), year: Number(year) }
  if (date.year < MIN_YEAR) return fail(`Год — не раньше ${String(MIN_YEAR)}.`)
  if (date.month < 1 || date.month > 12) return fail('Месяц — число от 1 до 12.')
  const days = daysInMonth(date.year, date.month)
  if (date.day < 1 || date.day > days) {
    return fail(`Такой даты нет: в ${monthsPrepositional[date.month - 1] ?? ''} ${String(date.year)} года ${String(days)} ${daysWord(days)}.`)
  }
  if (compareDates(date, today) > 0) return fail('Дата не может быть позже сегодняшней.')
  return { date, error: null }
}

/** The spelled-out echo under the date: «12 марта 1990, понедельник». */
export function formatDate(date: CalendarDate): string {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day))
  const dayMonthYear = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(utc).replace(/\s*г\.$/, '')
  const weekday = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long' }).format(utc)
  return `${dayMonthYear}, ${weekday}`
}

/** «12.03.1990», «12/3/1990», «12 03 1990» → parts; anything else → null. */
export function parsePastedDate(text: string): DateParts | null {
  const match = /^\s*(\d{1,2})[.\-/\s](\d{1,2})[.\-/\s](\d{4})\s*$/.exec(text)
  if (!match) return null
  const [, day = '', month = '', year = ''] = match
  return { day: day.padStart(2, '0'), month: month.padStart(2, '0'), year }
}

/** «1430», «14.30», «9:05» → «14:30», «09:05»; null if it is not a time of day. */
export function normalizeTime(raw: string): string | null {
  const digits = raw.trim().replace(/[.,\s-]/g, ':')
  const match = /^(\d{1,2}):?(\d{2})$/.exec(digits)
  if (!match) return null
  const [, h = '', m = ''] = match
  const hours = Number(h)
  const minutes = Number(m)
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${m}`
}

export function validateTime(time: TimeAnswer): string | null {
  if (time.kind === null) return 'Выбери: знаешь время или нет.'
  if (time.kind === 'unknown') return null
  if (normalizeTime(time.hhmm) === null) return 'Укажи время в формате 14:30.'
  if (time.source === null || time.source === 'unknown') return 'Откуда известно время?'
  return null
}

/** Accuracy suggested by the source until the visitor picks it (SCR-02 §0.5). */
export const accuracyBySource: Record<Exclude<TimeSource, 'unknown'>, TimeAccuracy> = {
  document: 0,
  family: 15,
  approximate: 60,
}
