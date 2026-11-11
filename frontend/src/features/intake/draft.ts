import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

import { earlierStep, intakeSteps, parseStep, type IntakeStep } from './steps'
import { validateDate, validateName, validateTime, type CalendarDate, type DateParts, type TimeAnswer } from './validation'

// The guest draft of SCR-02 (ARCHITECTURE_MVP_v2 §8, decision 11): the tab's
// sessionStorage only — no localStorage, no server, nothing in the URL,
// analytics or logs. Unfinished values are kept too, so a reload loses nothing.

export const DRAFT_KEY = 'cosmos.intake.v1'
export const DRAFT_VERSION = 1
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const SAVE_DELAY_MS = 150

export interface PlaceChoice {
  id: string
  name: string
  region?: string
  country: string
}

export interface IntakeDraft {
  step: IntakeStep
  name: string
  date: DateParts
  place: { query: string; selected: PlaceChoice | null }
  time: TimeAnswer & { accuracyTouched: boolean }
}

interface StoredDraft extends IntakeDraft {
  version: number
  updatedAt: number
}

export function emptyDraft(): IntakeDraft {
  return {
    step: 'name',
    name: '',
    date: { day: '', month: '', year: '' },
    place: { query: '', selected: null },
    time: { kind: null, hhmm: '', source: null, accuracy: null, accuracyTouched: false },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const isString = (value: unknown): value is string => typeof value === 'string'

function readPlace(value: unknown): PlaceChoice | null {
  if (!isObject(value) || !isString(value.id) || !isString(value.name) || !isString(value.country)) return null
  return { id: value.id, name: value.name, country: value.country, ...(isString(value.region) ? { region: value.region } : {}) }
}

function readTime(value: unknown): IntakeDraft['time'] | null {
  if (!isObject(value)) return null
  const kind = value.kind === 'known' || value.kind === 'unknown' ? value.kind : null
  const sources = ['document', 'family', 'approximate', 'unknown'] as const
  const source = sources.find((s) => s === value.source) ?? null
  const accuracy = ([0, 15, 30, 60] as const).find((a) => a === value.accuracy) ?? null
  if (!isString(value.hhmm)) return null
  return { kind, hhmm: value.hhmm, source, accuracy, accuracyTouched: value.accuracyTouched === true }
}

/** A stored draft, or null when it is missing, foreign, expired or damaged. */
export function parseDraft(raw: string | null, now: number = Date.now()): IntakeDraft | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(data) || data.version !== DRAFT_VERSION || typeof data.updatedAt !== 'number') return null
  if (now - data.updatedAt > DRAFT_TTL_MS || data.updatedAt > now + 60_000) return null
  const step = parseStep(data.step)
  const date = data.date
  const place = data.place
  const time = readTime(data.time)
  if (!step || !isString(data.name) || !isObject(date) || !isObject(place) || !time) return null
  if (!isString(date.day) || !isString(date.month) || !isString(date.year) || !isString(place.query)) return null
  return {
    step,
    name: data.name,
    date: { day: date.day, month: date.month, year: date.year },
    place: { query: place.query, selected: place.selected === null ? null : readPlace(place.selected) },
    time,
  }
}

export function serializeDraft(draft: IntakeDraft, now: number = Date.now()): string {
  const stored: StoredDraft = { version: DRAFT_VERSION, updatedAt: now, ...draft }
  return JSON.stringify(stored)
}

export function stepError(draft: IntakeDraft, step: IntakeStep, today?: CalendarDate): string | null {
  switch (step) {
    case 'name':
      return validateName(draft.name)
    case 'date':
      return validateDate(draft.date, today).error
    case 'place':
      if (draft.place.selected) return null
      return draft.place.query.trim() ? 'Выбери город из списка — так мы точно определим координаты.' : 'Начни вводить название города.'
    case 'time':
      return validateTime(draft.time)
  }
}

/** First step whose answer is missing or invalid; null when the whole intake is filled in. */
export function firstIncomplete(draft: IntakeDraft, today?: CalendarDate): IntakeStep | null {
  return intakeSteps.find((step) => stepError(draft, step, today) !== null) ?? null
}

/**
 * Which step a link may open (SCR-02 §0.6): the requested one or the saved
 * one, but never past the first unanswered question.
 */
export function reachableStep(draft: IntakeDraft, requested: IntakeStep | null, today?: CalendarDate): IntakeStep {
  const wanted = requested ?? draft.step
  const open = firstIncomplete(draft, today)
  return open ? earlierStep(wanted, open) : wanted
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export const useIntakeDraft = defineStore('intakeDraft', () => {
  const store = storage()
  let stored: IntakeDraft | null = null
  try {
    const raw = store?.getItem(DRAFT_KEY) ?? null
    stored = parseDraft(raw)
    if (raw !== null && stored === null) store?.removeItem(DRAFT_KEY)
  } catch {
    stored = null
  }
  const draft = reactive<IntakeDraft>(stored ?? emptyDraft())

  let timer: ReturnType<typeof setTimeout> | undefined

  function save() {
    clearTimeout(timer)
    timer = undefined
    try {
      store?.setItem(DRAFT_KEY, serializeDraft(draft))
    } catch {
      // Private mode or a full quota: the draft lives in memory until reload.
    }
  }

  watch(
    draft,
    () => {
      clearTimeout(timer)
      timer = setTimeout(save, SAVE_DELAY_MS)
    },
    { deep: true },
  )

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (timer !== undefined) save()
    })
  }

  function reset() {
    Object.assign(draft, emptyDraft())
    clearTimeout(timer)
    timer = undefined
    try {
      store?.removeItem(DRAFT_KEY)
    } catch {
      // Nothing stored to clear.
    }
  }

  return { draft, save, reset }
})
