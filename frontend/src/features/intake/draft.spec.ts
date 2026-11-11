import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { DRAFT_KEY, DRAFT_TTL_MS, emptyDraft, firstIncomplete, parseDraft, reachableStep, serializeDraft, useIntakeDraft, type IntakeDraft } from './draft'

const today = { year: 2026, month: 11, day: 11 }

function filled(): IntakeDraft {
  return {
    step: 'time',
    name: 'Анна',
    date: { day: '12', month: '03', year: '1990' },
    place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
    time: { kind: 'unknown', hhmm: '', source: 'unknown', accuracy: 0, accuracyTouched: false },
  }
}

describe('draft storage format', () => {
  it('round-trips', () => {
    const now = 1_800_000_000_000
    expect(parseDraft(serializeDraft(filled(), now), now)).toEqual(filled())
  })

  it('drops damaged, foreign and expired drafts', () => {
    const now = 1_800_000_000_000
    expect(parseDraft('{oops', now)).toBeNull()
    expect(parseDraft(JSON.stringify({ ...JSON.parse(serializeDraft(filled(), now)), version: 2 }), now)).toBeNull()
    expect(parseDraft(serializeDraft(filled(), now - DRAFT_TTL_MS - 1), now)).toBeNull()
    expect(parseDraft(JSON.stringify({ version: 1, updatedAt: now, step: 'name' }), now)).toBeNull()
  })
})

describe('which step a link may open', () => {
  it('never skips an unanswered question', () => {
    const draft = emptyDraft()
    expect(reachableStep(draft, 'time', today)).toBe('name')
    draft.name = 'Анна'
    expect(reachableStep(draft, 'time', today)).toBe('date')
    expect(reachableStep(draft, null, today)).toBe('name')
  })

  it('opens any step of a complete draft, the saved one by default', () => {
    expect(firstIncomplete(filled(), today)).toBeNull()
    expect(reachableStep(filled(), 'date', today)).toBe('date')
    expect(reachableStep(filled(), null, today)).toBe('time')
  })

  it('counts a typed but unselected city as unanswered', () => {
    const draft = filled()
    draft.place.selected = null
    expect(firstIncomplete(draft, today)).toBe('place')
  })
})

describe('useIntakeDraft', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes to sessionStorage shortly after a change, and only there', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem')
    const store = useIntakeDraft()
    store.draft.name = 'Анна'
    await nextTick()
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
    vi.advanceTimersByTime(200)
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}')).toMatchObject({ version: 1, name: 'Анна' })
    expect(localStorage.length).toBe(0)
    local.mockRestore()
  })

  it('restores a saved draft and discards a damaged one', () => {
    sessionStorage.setItem(DRAFT_KEY, serializeDraft(filled()))
    expect(useIntakeDraft().draft.place.selected?.id).toBe('ru-kzn')

    sessionStorage.setItem(DRAFT_KEY, '{oops')
    setActivePinia(createPinia())
    expect(useIntakeDraft().draft).toEqual(emptyDraft())
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('flushes on pagehide', async () => {
    const store = useIntakeDraft()
    store.draft.name = 'Мира'
    await nextTick()
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}')).toMatchObject({ name: 'Мира' })
  })
})
