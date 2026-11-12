import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createAppRouter } from '@/app/router'
import { normalizeCode, syntheticCodes } from '@/mocks/access'
import { accessMock } from '@/mocks/handlers'
import { server } from '@/mocks/node'
import { recordCheck } from '@/features/intake/checkStamp'
import { useIntakeDraft } from '@/features/intake/draft'
import { toProfile } from '@/features/intake/review'

import { accessTexts } from './access'
import AccessView from './AccessView.vue'

const AUTH = '/api/v1/auth/code'
const SESSION = '/api/v1/session'

const maskOf = (code: string) => (normalizeCode(code) ?? '').slice(-4)

function problem(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return HttpResponse.json({ type: 'about:blank', title: 'Error', status, ...body }, { status, headers: { 'content-type': 'application/problem+json', ...headers } })
}

/** Bodies of every POST /auth/code; the request then goes on to the regular mock. */
function recordLogins(): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.post(AUTH, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

async function fillCheckedDraft() {
  const { draft } = useIntakeDraft()
  Object.assign(draft, {
    step: 'time',
    name: 'Тестовая Вега',
    date: { day: '12', month: '03', year: '1990' },
    place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
    time: { kind: 'known', hhmm: '14:30', source: 'document', accuracy: 0, accuracyTouched: false },
  })
  const profile = toProfile(draft)
  if (!profile) throw new Error('incomplete draft')
  await recordCheck(profile)
}

async function open() {
  const router = createAppRouter(createMemoryHistory())
  await router.push('/create/review')
  await router.push('/create/access')
  expect(router.currentRoute.value.path).toBe('/create/access')
  const wrapper = mount(AccessView, { attachTo: document.body, global: { plugins: [router] } })
  return { router, wrapper }
}

const input = () => document.querySelector<HTMLInputElement>('#access-code')
const primary = () => document.querySelector<HTMLButtonElement>('.access__next')
const status = () => document.querySelector('.access__status-text')?.textContent.trim() ?? ''
const fieldMessage = () => document.querySelector('.field__message')?.textContent.trim() ?? ''
const sessionValue = () => document.querySelector('.access__value > span[aria-hidden="true"]')?.textContent.trim() ?? ''
const buttonByText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)

async function entry() {
  await vi.waitFor(() => {
    expect(input()).not.toBeNull()
  })
}

async function type(value: string) {
  const el = input()
  if (!el) throw new Error('no code field')
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submitCode(value: string) {
  await type(value)
  primary()?.click()
}

beforeEach(async () => {
  sessionStorage.clear()
  localStorage.clear()
  accessMock.reset()
  setActivePinia(createPinia())
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  await fillCheckedDraft()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('AccessView: entry', () => {
  it('shows the heading at once, then the code field with focus on desktop', async () => {
    await open()

    expect(document.querySelector('h1')?.textContent).toContain('Данные заполнены.')
    expect(document.querySelector('h1')?.textContent).toContain('Остался доступ к персональному разбору.')
    expect(document.querySelector('.access__lead')?.textContent.trim()).toBe('Введи код доступа, чтобы продолжить создание своей натальной карты')
    expect(input()).toBeNull()

    await entry()
    expect(document.activeElement).toBe(input())
    expect(fieldMessage()).toBe('Например, LK-XXXXX-… Регистр и дефисы не важны.')
    expect(primary()?.textContent.trim()).toBe('Проверить код')
  })

  it('keeps the heading focused on touch screens, so no keyboard rises', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    await open()
    await entry()
    expect(document.activeElement).toBe(document.querySelector('h1'))
  })

  it('sets the code field attributes of §0.8', async () => {
    await open()
    await entry()
    const el = input()
    expect(el?.getAttribute('autocomplete')).toBe('off')
    expect(el?.getAttribute('autocapitalize')).toBe('characters')
    expect(el?.getAttribute('spellcheck')).toBe('false')
    expect(el?.getAttribute('enterkeyhint')).toBe('go')
    expect(el?.getAttribute('maxlength')).toBe('64')
    expect(el?.hasAttribute('name')).toBe(false)
  })

  it('shows «Где получить код?» as plain text, not a link', async () => {
    await open()
    await entry()
    const where = document.querySelector('.access__where')
    expect(where?.textContent).toContain('Где получить код?')
    expect(where?.querySelector('a, button, [tabindex]')).toBeNull()
    expect(document.querySelector('a[href="/natal-chart"]')).toBeNull()
  })

  it('treats a failed session read as no session', async () => {
    server.use(http.get(SESSION, () => problem(503, { code: 'internal_error' })))
    await open()
    await entry()
  })
})

describe('AccessView: checking a code', () => {
  it('asks for a code without a request when the field is empty', async () => {
    const bodies = recordLogins()
    await open()
    await entry()

    await submitCode('   ')
    await flushPromises()
    expect(fieldMessage()).toBe(accessTexts.empty)
    expect(input()?.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input())
    expect(bodies).toHaveLength(0)
  })

  it('accepts a free code, wipes the field and continues to consent', async () => {
    const bodies = recordLogins()
    const { router } = await open()
    await entry()

    await submitCode(syntheticCodes.available)
    await vi.waitFor(() => {
      expect(sessionValue()).toBe(`Код ••••${maskOf(syntheticCodes.available)} принят.`)
    })
    expect(bodies).toEqual([{ code: syntheticCodes.available }])
    expect(input()).toBeNull()
    expect(document.querySelector('form')?.textContent).not.toContain(syntheticCodes.available)
    expect(primary()?.textContent.trim()).toBe('Продолжить')
    expect(document.activeElement).toBe(primary())

    primary()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/consent')
    })
  })

  it('opens the existing reading for a used code and creates nothing', async () => {
    const orders: string[] = []
    server.use(http.post('/api/v1/orders', ({ request }) => {
      orders.push(request.url)
      return HttpResponse.json({})
    }))
    const { router } = await open()
    await entry()

    await submitCode(syntheticCodes.consumed)
    await vi.waitFor(() => {
      expect(sessionValue()).toBe('По этому коду уже создан разбор.')
    })
    expect(document.querySelector('.access__note')?.textContent.trim()).toBe('Твоя анкета сохранится для другого кода.')
    expect(primary()?.textContent.trim()).toBe('Открыть разбор')
    expect(document.activeElement).toBe(primary())

    primary()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/orders/00000000-0000-4000-8000-0000000d0001')
    })
    expect(orders).toHaveLength(0)
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })

  it.each([
    ['unknown', syntheticCodes.unknown, accessTexts.invalid],
    ['blocked', syntheticCodes.blocked, accessTexts.invalid],
    ['malformed', 'ABC-123', 'Код не распознан. Проверь, что он введён полностью. Если код получен до запуска нового сайта, напиши в поддержку.'],
    ['bound to an account', syntheticCodes.boundToAccount, 'Этот код уже привязан к личному кабинету, поэтому его нельзя ввести здесь.'],
  ])('keeps a %s code in the field with the error under it', async (_kind, value, message) => {
    await open()
    await entry()

    await submitCode(value)
    await vi.waitFor(() => {
      expect(fieldMessage()).toBe(message)
    })
    expect(input()?.value).toBe(value)
    expect(input()?.getAttribute('aria-invalid')).toBe('true')
    expect(input()?.getAttribute('aria-describedby')).toBe('access-code-message')
    expect(document.activeElement).toBe(input())
    expect(status()).toBe(`Ошибка: ${message}`)
    expect(document.querySelector('.field__message a')).toBeNull()
  })

  it('sends one request for a double press', async () => {
    const bodies = recordLogins()
    await open()
    await entry()

    await type(syntheticCodes.available)
    primary()?.click()
    primary()?.click()
    await vi.waitFor(() => {
      expect(sessionValue()).toContain('принят')
    })
    expect(bodies).toHaveLength(1)
  })

  it('shows «Проверяем код…» and an inactive button only when the answer is slow', async () => {
    let release: () => void = () => undefined
    server.use(http.post(AUTH, () => new Promise<undefined>((resolve) => {
      release = () => {
        resolve(undefined)
      }
    })))
    await open()
    await entry()

    await submitCode(syntheticCodes.available)
    await flushPromises()
    expect(primary()?.hasAttribute('aria-disabled')).toBe(false)
    await vi.waitFor(() => {
      expect(status()).toBe('Проверяем код…')
    })
    expect(primary()?.getAttribute('aria-disabled')).toBe('true')
    expect(input()?.value).toBe(syntheticCodes.available)
    release()
    await vi.waitFor(() => {
      expect(sessionValue()).toContain('принят')
    })
  })

  it('holds the button for Retry-After after a rate limit, without retrying', async () => {
    let calls = 0
    server.use(http.post(AUTH, () => {
      calls += 1
      return problem(429, { code: 'rate_limited', detail: 'Подожди минуту и попробуй снова.' }, { 'retry-after': '60' })
    }))
    await open()
    await entry()

    await submitCode(syntheticCodes.available)
    await vi.waitFor(() => {
      expect(status()).toBe('Подожди минуту и попробуй снова.')
    })
    expect(primary()?.getAttribute('aria-disabled')).toBe('true')
    primary()?.click()
    await flushPromises()
    expect(calls).toBe(1)
    expect(input()?.value).toBe(syntheticCodes.available)
  })

  it('uses its own text for a rate limit without detail', async () => {
    server.use(http.post(AUTH, () => problem(429, { code: 'rate_limited' })))
    await open()
    await entry()
    await submitCode(syntheticCodes.available)
    await vi.waitFor(() => {
      expect(status()).toBe(accessTexts.rateLimited)
    })
    expect(primary()?.hasAttribute('aria-disabled')).toBe(false)
  })

  it.each([
    ['a server error', () => problem(503, { code: 'internal_error' })],
    ['an unreadable request', () => problem(400, { code: 'validation_failed' })],
    ['a network failure', () => HttpResponse.error()],
  ])('offers a manual retry after %s', async (_kind, reply) => {
    server.use(http.post(AUTH, reply, { once: true }))
    await open()
    await entry()

    await submitCode(syntheticCodes.available)
    await vi.waitFor(() => {
      expect(status()).toBe(accessTexts.failed)
    })
    expect(input()?.value).toBe(syntheticCodes.available)

    primary()?.click()
    await vi.waitFor(() => {
      expect(sessionValue()).toContain('принят')
    })
  })

  it('never puts the code in the URL, browser storage or the console', async () => {
    const log = vi.spyOn(console, 'log')
    const info = vi.spyOn(console, 'info')
    const warn = vi.spyOn(console, 'warn')
    const error = vi.spyOn(console, 'error')
    const { router } = await open()
    await entry()

    await submitCode(syntheticCodes.unknown)
    await vi.waitFor(() => {
      expect(fieldMessage()).toBe(accessTexts.invalid)
    })
    await submitCode(syntheticCodes.available)
    await vi.waitFor(() => {
      expect(sessionValue()).toContain('принят')
    })

    const stored = [sessionStorage, localStorage].flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ''}`)).join('\n')
    for (const code of [syntheticCodes.unknown, syntheticCodes.available]) {
      expect(router.currentRoute.value.fullPath).not.toContain(code)
      expect(stored).not.toContain(code)
      expect(stored).not.toContain(normalizeCode(code) ?? '')
    }
    for (const spy of [log, info, warn, error]) expect(spy).not.toHaveBeenCalled()
  })

  it('returns to the review with the draft in place', async () => {
    const { router } = await open()
    await entry()

    buttonByText('Назад')?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/review')
    })
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })
})

describe('AccessView: an open code session (А8)', () => {
  it('shows an accepted session instead of the field and keeps the heading focused', async () => {
    accessMock.seed('available')
    await open()

    await vi.waitFor(() => {
      expect(sessionValue()).toBe(`Код ••••${maskOf(syntheticCodes.available)} уже принят.`)
    })
    expect(input()).toBeNull()
    expect(document.querySelector('.access__value .visually-hidden')?.textContent).toBe(
      `Код, оканчивающийся на ${maskOf(syntheticCodes.available).split('').join(' ')}, уже принят.`,
    )
    expect(document.activeElement).toBe(document.querySelector('h1'))
    expect(primary()?.textContent.trim()).toBe('Продолжить')
    expect(document.querySelector('.access__where')).toBeNull()
  })

  it('shows a used session with the way to its reading', async () => {
    accessMock.seed('consumed')
    const { router } = await open()

    await vi.waitFor(() => {
      expect(sessionValue()).toBe(`По коду ••••${maskOf(syntheticCodes.consumed)} уже создан разбор.`)
    })
    primary()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order')
    })
  })

  it('replaces the session only after «Использовать другой код», with replace_session', async () => {
    accessMock.seed('available')
    const bodies = recordLogins()
    await open()
    await vi.waitFor(() => {
      expect(sessionValue()).toContain('уже принят')
    })

    buttonByText('Использовать другой код')?.click()
    await flushPromises()
    expect(document.activeElement).toBe(input())
    expect(input()?.value).toBe('')
    const note = document.querySelector('#access-code-extra')
    expect(note?.textContent).toContain(`••••${maskOf(syntheticCodes.available)}`)
    expect(note?.textContent).toContain('закроется в этом браузере. Его можно будет ввести снова.')
    expect(input()?.getAttribute('aria-describedby')).toBe('access-code-extra')

    await submitCode(syntheticCodes.availableOther)
    await vi.waitFor(() => {
      expect(sessionValue()).toBe(`Код ••••${maskOf(syntheticCodes.availableOther)} принят.`)
    })
    expect(bodies).toEqual([{ code: syntheticCodes.availableOther, replace_session: true }])
    expect(accessMock.session()).toMatchObject({ principal: 'code', entitlement: { code_mask: maskOf(syntheticCodes.availableOther) } })
  })

  it('goes back to the accepted code on «Отмена» without a request', async () => {
    accessMock.seed('available')
    const bodies = recordLogins()
    await open()
    await vi.waitFor(() => {
      expect(sessionValue()).toContain('уже принят')
    })

    buttonByText('Использовать другой код')?.click()
    await flushPromises()
    await type(syntheticCodes.availableOther)
    buttonByText('Отмена')?.click()
    await flushPromises()

    expect(sessionValue()).toContain('уже принят')
    expect(document.activeElement).toBe(primary())
    expect(bodies).toHaveLength(0)
    buttonByText('Использовать другой код')?.click()
    await flushPromises()
    expect(input()?.value).toBe('')
  })

  it('keeps the old session when the replacing code is refused', async () => {
    accessMock.seed('available')
    await open()
    await vi.waitFor(() => {
      expect(sessionValue()).toContain('уже принят')
    })

    buttonByText('Использовать другой код')?.click()
    await flushPromises()
    await submitCode(syntheticCodes.unknown)
    await vi.waitFor(() => {
      expect(fieldMessage()).toBe(accessTexts.invalid)
    })
    expect(document.querySelector('#access-code-extra')?.textContent).toContain('закроется в этом браузере')
    expect(accessMock.session()).toMatchObject({ principal: 'code', entitlement: { code_mask: maskOf(syntheticCodes.available) } })
  })

  it('asks on 409 when the session was not seen, and replaces only on «Заменить»', async () => {
    accessMock.seed('available')
    server.use(http.get(SESSION, () => HttpResponse.json({ principal: 'anonymous' }), { once: true }))
    const bodies = recordLogins()
    await open()
    await entry()

    await submitCode(syntheticCodes.availableOther)
    await vi.waitFor(() => {
      expect(document.querySelector('#access-code-extra')?.textContent).toContain(`В этом браузере уже открыт другой код (••••${maskOf(syntheticCodes.available)}).`)
    })
    expect(document.activeElement).toBe(buttonByText('Заменить'))
    expect(input()?.value).toBe(syntheticCodes.availableOther)
    expect(fieldMessage()).toBe('')
    expect(accessMock.session()).toMatchObject({ entitlement: { code_mask: maskOf(syntheticCodes.available) } })

    buttonByText('Заменить')?.click()
    await vi.waitFor(() => {
      expect(sessionValue()).toBe(`Код ••••${maskOf(syntheticCodes.availableOther)} принят.`)
    })
    expect(bodies).toEqual([{ code: syntheticCodes.availableOther }, { code: syntheticCodes.availableOther, replace_session: true }])
  })

  it('keeps the current code on «Оставить текущий»', async () => {
    accessMock.seed('available')
    server.use(http.get(SESSION, () => HttpResponse.json({ principal: 'anonymous' }), { once: true }))
    await open()
    await entry()

    await submitCode(syntheticCodes.availableOther)
    await vi.waitFor(() => {
      expect(buttonByText('Оставить текущий')).toBeDefined()
    })
    buttonByText('Оставить текущий')?.click()
    await flushPromises()

    expect(sessionValue()).toBe(`Код ••••${maskOf(syntheticCodes.available)} уже принят.`)
    expect(input()).toBeNull()
    expect(document.activeElement).toBe(primary())
    expect(accessMock.session()).toMatchObject({ entitlement: { code_mask: maskOf(syntheticCodes.available) } })
  })

  it('accepts the same code again without a question', async () => {
    accessMock.seed('available')
    server.use(http.get(SESSION, () => HttpResponse.json({ principal: 'anonymous' }), { once: true }))
    await open()
    await entry()

    await submitCode(syntheticCodes.available)
    await vi.waitFor(() => {
      expect(sessionValue()).toBe(`Код ••••${maskOf(syntheticCodes.available)} принят.`)
    })
    expect(buttonByText('Заменить')).toBeUndefined()
  })
})
