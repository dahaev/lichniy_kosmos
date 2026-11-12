import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import { createMemoryHistory } from 'vue-router'

import { createAppRouter } from '@/app/router'
import { server } from '@/mocks/node'

import { CHECK_KEY, isCheckedProfile } from './checkStamp'
import { useIntakeDraft } from './draft'
import IntakeView from './IntakeView.vue'
import { toProfile } from './review'
import ReviewView from './ReviewView.vue'

const CHECK = '/api/v1/profile-checks'

function problem(status: number, body: Record<string, unknown>) {
  return HttpResponse.json({ type: 'about:blank', title: 'Error', status, ...body }, { status, headers: { 'content-type': 'application/problem+json' } })
}

function fillDraft() {
  Object.assign(useIntakeDraft().draft, {
    step: 'time',
    name: 'Тестовая Вега',
    date: { day: '12', month: '03', year: '1990' },
    place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
    time: { kind: 'known', hhmm: '14:30', source: 'document', accuracy: 0, accuracyTouched: false },
  })
}

async function open(path: string, component: Component = ReviewView) {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(component, { attachTo: document.body, global: { plugins: [router] } })
  return { router, wrapper }
}

const status = () => document.querySelector('.review__status-text')?.textContent.trim() ?? ''
const continueButton = () => document.querySelector<HTMLButtonElement>('.review__next')

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom has no layout: no scrolling, no media queries.
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  fillDraft()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('ReviewView', () => {
  it('shows the four answers at once and the heading takes focus', async () => {
    await open('/create/review')

    const values = [...document.querySelectorAll('.review__value')].map((el) => el.textContent.trim())
    expect(values).toEqual(['Тестовая Вега', '12 марта 1990', 'Казань', '14:30'])
    expect(document.activeElement).toBe(document.querySelector('h1'))
  })

  it('checks on entry and continues to access only after the server agrees', async () => {
    const { router } = await open('/create/review')

    expect(continueButton()?.getAttribute('aria-disabled')).toBe('true')
    await vi.waitFor(() => {
      expect(status()).toBe('Данные проверены.')
    })
    expect(continueButton()?.hasAttribute('aria-disabled')).toBe(false)

    continueButton()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/access')
    })
  })

  it('keeps the visitor on the review while the check is running and points at the status', async () => {
    const { router } = await open('/create/review')

    continueButton()?.click()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/create/review')
    expect(document.activeElement).toBe(document.querySelector('.review__status'))
  })

  it('puts a field error in its block and the summary, and «Изменить» opens the step in edit mode', async () => {
    server.use(http.post(CHECK, () => problem(422, { code: 'validation_failed', fields: { birth_date: 'Дата не может быть позже сегодняшней.' } })))
    const { router } = await open('/create/review')

    await vi.waitFor(() => {
      expect(status()).toBe('Нужно поправить: дата рождения.')
    })
    const date = document.querySelector('[data-step="date"]')
    expect(date?.querySelector('.review__note--error')?.textContent).toContain('Дата не может быть позже сегодняшней.')
    expect(document.querySelectorAll('.review__note--error')).toHaveLength(1)
    expect(continueButton()?.getAttribute('aria-disabled')).toBe('true')

    document.querySelector<HTMLButtonElement>('[aria-label="Изменить дату рождения"]')?.click()
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/create?step=date&from=review')
  })

  it('offers «Проверить ещё раз» after a failure and drops it once the check passes', async () => {
    server.use(http.post(CHECK, () => problem(503, { code: 'internal_error' }), { once: true }))
    await open('/create/review')

    await vi.waitFor(() => {
      expect(status()).toBe('Не удалось проверить данные. Проверь соединение и попробуй ещё раз.')
    })
    const retry = document.querySelector<HTMLButtonElement>('.review__retry')
    expect(retry).not.toBeNull()

    retry?.focus()
    retry?.click()
    await flushPromises()
    expect(status()).toBe('Сверяем данные…')
    expect(document.querySelector('.review__retry')?.getAttribute('aria-disabled')).toBe('true')

    await vi.waitFor(() => {
      expect(status()).toBe('Данные проверены.')
    })
    expect(document.querySelector('.review__retry')).toBeNull()
    expect(document.activeElement).toBe(continueButton())
  })

  it('shows the server text for a rate limit', async () => {
    server.use(http.post(CHECK, () => problem(429, { code: 'rate_limited', detail: 'Подожди минуту и попробуй снова.' })))
    await open('/create/review')

    await vi.waitFor(() => {
      expect(status()).toBe('Подожди минуту и попробуй снова.')
    })
  })

  it('records the checked profile for the access guard and drops it when a new check fails (SCR-04 §0.4)', async () => {
    const { wrapper } = await open('/create/review')
    await vi.waitFor(() => {
      expect(status()).toBe('Данные проверены.')
    })
    const profile = toProfile(useIntakeDraft().draft)
    if (!profile) throw new Error('incomplete draft')
    expect(await isCheckedProfile(profile)).toBe(true)
    wrapper.unmount()

    server.use(http.post(CHECK, () => problem(503, { code: 'internal_error' })))
    await open('/create/review')
    await vi.waitFor(() => {
      expect(status()).toBe('Не удалось проверить данные. Проверь соединение и попробуй ещё раз.')
    })
    expect(sessionStorage.getItem(CHECK_KEY)).toBeNull()
  })

  it('sends a fresh check on every entry (Р5)', async () => {
    let calls = 0
    server.use(http.post(CHECK, () => {
      calls += 1
      return problem(503, { code: 'internal_error' })
    }))
    const { router, wrapper } = await open('/create/review')
    await vi.waitFor(() => {
      expect(calls).toBe(1)
    })
    wrapper.unmount()

    await router.push('/create?step=name&from=review')
    mount(ReviewView, { attachTo: document.body, global: { plugins: [router] } })
    await vi.waitFor(() => {
      expect(calls).toBe(2)
    })
  })
})

describe('IntakeView edit mode (SCR-03 C-R3)', () => {
  it('returns to the review after confirming the answer', async () => {
    const { router } = await open('/create?step=date&from=review', IntakeView)

    expect(document.querySelector('.intake__next')?.textContent).toContain('Проверить данные')
    document.querySelector<HTMLButtonElement>('.intake__next')?.click()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/create/review')
  })

  it('returns to the review on «Назад»', async () => {
    const { router } = await open('/create?step=place&from=review', IntakeView)

    document.querySelector<HTMLButtonElement>('.intake__back')?.click()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/create/review')
  })

  it('stays on the step while the edited answer is invalid', async () => {
    useIntakeDraft().draft.date.day = '31'
    useIntakeDraft().draft.date.month = '02'
    const { router } = await open('/create?step=date&from=review', IntakeView)

    document.querySelector<HTMLButtonElement>('.intake__next')?.click()
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/create?step=date&from=review')
  })

  it('keeps the usual order outside edit mode', async () => {
    const { router } = await open('/create?step=date', IntakeView)

    expect(document.querySelector('.intake__next')?.textContent).toContain('Далее')
    document.querySelector<HTMLButtonElement>('.intake__next')?.click()
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/create?step=place')
  })
})
