import { describe, expect, it } from 'vitest'

import { formatDate, moscowToday, normalizeTime, parsePastedDate, validateDate, validateName, validateTime } from './validation'

const today = { year: 2026, month: 11, day: 11 }
const date = (day: string, month: string, year: string) => validateDate({ day, month, year }, today)

describe('validateName', () => {
  it('trims and requires at least one character', () => {
    expect(validateName('   ')).toBe('Напиши имя — им мы подпишем карту.')
    expect(validateName('  Анна ')).toBeNull()
  })

  it('counts code points, so 60 emoji are still 60 characters', () => {
    expect(validateName('🌙'.repeat(60))).toBeNull()
    expect(validateName('🌙'.repeat(61))).toBe('Не длиннее 60 символов.')
    expect(validateName('а'.repeat(61))).toBe('Не длиннее 60 символов.')
  })
})

describe('validateDate', () => {
  it('accepts a real past date', () => {
    expect(date('12', '03', '1990')).toEqual({ date: { year: 1990, month: 3, day: 12 }, error: null })
  })

  it('names the missing parts', () => {
    expect(date('', '03', '1990').error).toBe('Укажи день, месяц и год.')
  })

  it('knows leap years', () => {
    expect(date('29', '02', '2000').error).toBeNull()
    expect(date('29', '02', '1990').error).toBe('Такой даты нет: в феврале 1990 года 28 дней.')
    expect(date('31', '04', '1990').error).toBe('Такой даты нет: в апреле 1990 года 30 дней.')
  })

  it('keeps 1900 to today', () => {
    expect(date('31', '12', '1899').error).toBe('Год — не раньше 1900.')
    expect(date('01', '01', '1900').error).toBeNull()
    expect(date('11', '11', '2026').error).toBeNull()
    expect(date('12', '11', '2026').error).toBe('Дата не может быть позже сегодняшней.')
  })

  it('rejects a short year and a 13th month', () => {
    expect(date('12', '03', '90').error).toBe('Год — четыре цифры, например 1990.')
    expect(date('12', '13', '1990').error).toBe('Месяц — число от 1 до 12.')
  })
})

describe('moscowToday', () => {
  it('is the Moscow date, not the UTC one', () => {
    // 22:30 UTC on 10 November is already 11 November in Moscow (UTC+3).
    expect(moscowToday(new Date('2026-11-10T22:30:00Z'))).toEqual({ year: 2026, month: 11, day: 11 })
    expect(moscowToday(new Date('2026-11-10T20:59:00Z'))).toEqual({ year: 2026, month: 11, day: 10 })
  })
})

describe('formatDate', () => {
  it('spells the date out with the weekday', () => {
    expect(formatDate({ year: 1990, month: 3, day: 12 })).toBe('12 марта 1990, понедельник')
  })
})

describe('parsePastedDate', () => {
  it('splits common formats', () => {
    expect(parsePastedDate('12.03.1990')).toEqual({ day: '12', month: '03', year: '1990' })
    expect(parsePastedDate(' 1/3/1990 ')).toEqual({ day: '01', month: '03', year: '1990' })
    expect(parsePastedDate('1990-03-12')).toBeNull()
  })
})

describe('time', () => {
  it('normalizes what people type', () => {
    expect(normalizeTime('1430')).toBe('14:30')
    expect(normalizeTime('9:05')).toBe('09:05')
    expect(normalizeTime('00:00')).toBe('00:00')
    expect(normalizeTime('23:59')).toBe('23:59')
    expect(normalizeTime('24:00')).toBeNull()
    expect(normalizeTime('12:60')).toBeNull()
  })

  it('asks for the choice, the time and its source in that order', () => {
    const base = { kind: null, hhmm: '', source: null, accuracy: null } as const
    expect(validateTime(base)).toBe('Выбери: знаешь время или нет.')
    expect(validateTime({ ...base, kind: 'known' })).toBe('Укажи время в формате 14:30.')
    expect(validateTime({ ...base, kind: 'known', hhmm: '14:30' })).toBe('Откуда известно время?')
    expect(validateTime({ ...base, kind: 'known', hhmm: '14:30', source: 'family', accuracy: 15 })).toBeNull()
    expect(validateTime({ kind: 'unknown', hhmm: '', source: 'unknown', accuracy: 0 })).toBeNull()
  })
})
