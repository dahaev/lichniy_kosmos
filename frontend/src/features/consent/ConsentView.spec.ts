import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createAppRouter } from '@/app/router'
import { recordCheck } from '@/features/intake/checkStamp'
import { DRAFT_KEY, useIntakeDraft } from '@/features/intake/draft'
import { toProfile } from '@/features/intake/review'
import { syntheticCodes } from '@/mocks/access'
import { publicConfig, testCreationConfig } from '@/mocks/fixtures'
import { accessMock, ordersMock } from '@/mocks/handlers'
import { server } from '@/mocks/node'

import { ATTEMPT_KEY, consentTexts } from './consent'
import ConsentView from './ConsentView.vue'

const ORDERS = '/api/v1/orders'
const SESSION = '/api/v1/session'
const CONFIG = '/api/v1/config'
const ENTITLEMENT = '00000000-0000-4000-8000-00000000f001'
const FIRST_ORDER = '00000000-0000-4000-8000-0000000e0001'
const USED_ORDER = '00000000-0000-4000-8000-0000000d0001'
const MOCK_HEADER = { 'x-cosmos-mock': '1' }

const mounted: VueWrapper[] = []

function problem(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return HttpResponse.json({ type: 'about:blank', title: 'Error', status, ...body }, { status, headers: { 'content-type': 'application/problem+json', ...headers } })
}

/**
 * Clones that are read for recording. undici ties a clone to the original body:
 * when the clone object is garbage-collected, the original's stream is cancelled
 * if nobody has read it yet. The regular mock reads it only after its simulated
 * delay, so under memory pressure it failed with «Body is unusable» and answered
 * 400 `validation_failed`. Holding the clones keeps the original intact.
 */
const heldClones: Request[] = []

/** Every `POST /orders`: the key and the body; the request then goes on to the regular mock. */
function recordOrders(): { keys: (string | null)[]; bodies: unknown[] } {
  const seen: { keys: (string | null)[]; bodies: unknown[] } = { keys: [], bodies: [] }
  server.use(
    http.post(ORDERS, async ({ request }) => {
      seen.keys.push(request.headers.get('idempotency-key'))
      const copy = request.clone()
      heldClones.push(copy)
      seen.bodies.push(await copy.json())
    }),
  )
  return seen
}

/** The explicit test mode: a dev build, MSW on and `?creation=test` (SCR-05 §0.5). */
function testMode(extra = ''): void {
  vi.stubEnv('VITE_API_MOCKS', '1')
  window.history.replaceState(null, '', `/create/consent?creation=test${extra}`)
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
  await router.push('/create/consent')
  expect(router.currentRoute.value.path).toBe('/create/consent')
  const wrapper = mount(ConsentView, { attachTo: document.body, global: { plugins: [router] } })
  mounted.push(wrapper)
  return { router, wrapper }
}

const heading = () => document.querySelector('h1')
const checkbox = () => document.querySelector<HTMLInputElement>('#consent-check')
const cta = () => document.querySelector<HTMLButtonElement>('.consent__next')
const status = () => document.querySelector('.consent__status-text')?.textContent.trim() ?? ''
const slotText = () => document.querySelector('.consent__slot')?.textContent.trim() ?? ''
const buttonByText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)

/** The screen has read the session and the configuration and shows the confirmation. */
async function ready() {
  await vi.waitFor(() => {
    expect(checkbox()).not.toBeNull()
    expect(document.querySelector('.consent-test-text')).not.toBeNull()
  })
}

async function agree() {
  checkbox()?.click()
  await flushPromises()
}

const stored = () => [sessionStorage, localStorage].flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ''}`)).join('\n')

beforeEach(async () => {
  sessionStorage.clear()
  localStorage.clear()
  accessMock.reset()
  ordersMock.reset()
  setActivePinia(createPinia())
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  await fillCheckedDraft()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  heldClones.length = 0
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
  document.body.innerHTML = ''
})

describe('ConsentView: the summary (К2)', () => {
  it('shows the heading and the profile summary from the first frame, the mask once the session is read', async () => {
    accessMock.seed('available')
    await open()

    expect(heading()?.textContent).toContain('Последний шаг')
    expect(heading()?.textContent).toContain('перед твоим разбором.')
    expect(document.querySelector('.consent__lead')?.textContent.trim()).toBe(
      'Ещё раз взгляни на данные и доступ. После подтверждения начнётся создание разбора.',
    )
    expect(document.querySelector('[data-block="profile"] .consent__value')?.textContent.trim()).toBe('Тестовая Вега')
    expect(document.querySelector('[data-block="profile"] .consent__note')?.textContent.trim()).toBe('12 марта 1990 · Казань · 14:30')
    expect(document.querySelector('[data-block="access"] .consent__value')?.textContent.trim()).toBe('')
    expect(document.activeElement).toBe(heading())

    await vi.waitFor(() => {
      expect(document.querySelector('[data-block="access"] [aria-hidden="true"]')?.textContent.trim()).toBe('Код ••••F001')
    })
    expect(document.querySelector('[data-block="access"] .visually-hidden')?.textContent).toBe('Код, оканчивающийся на F 0 0 1')
    expect(document.querySelector('.consent__value')?.closest('dl')).not.toBeNull()
    expect(document.activeElement).toBe(heading())
  })

  it('says the time is unknown when it is', async () => {
    Object.assign(useIntakeDraft().draft.time, { kind: 'unknown', hhmm: '', source: 'unknown', accuracy: 0 })
    const profile = toProfile(useIntakeDraft().draft)
    if (!profile) throw new Error('incomplete draft')
    await recordCheck(profile)
    accessMock.seed('available')
    await open()

    expect(document.querySelector('[data-block="profile"] .consent__note')?.textContent.trim()).toBe('12 марта 1990 · Казань · время неизвестно')
  })

  it('names «Изменить» for a screen reader and sends it to the review with the draft in place', async () => {
    accessMock.seed('available')
    const { router } = await open()

    const edit = buttonByText('Изменить')
    expect(edit?.getAttribute('aria-label')).toBe('Изменить данные анкеты')
    edit?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/review')
    })
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })

  it('goes back to the access with the draft and the session in place', async () => {
    accessMock.seed('available')
    const { router } = await open()

    buttonByText('Назад')?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/access')
    })
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
    expect(accessMock.session()).toMatchObject({ principal: 'code' })
  })
})

describe('ConsentView: the session guard (§0.3)', () => {
  it('returns an anonymous visitor to the access, the draft untouched', async () => {
    const { router } = await open()

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/access')
    })
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })

  it('sends a used access to its order and creates nothing', async () => {
    accessMock.seed('consumed')
    const orders = recordOrders()
    const { router } = await open()

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe(`/orders/${USED_ORDER}`)
    })
    expect(orders.keys).toEqual([])
  })

  it('keeps creation shut and offers another check when the session cannot be read', async () => {
    accessMock.seed('available')
    server.use(http.get(SESSION, () => problem(503, { code: 'internal_error' })))
    await open()

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.configError)
    })
    expect(checkbox()).toBeNull()
    expect(cta()?.textContent.trim()).toBe('Проверить ещё раз')
  })

  it('keeps creation shut when the configuration cannot be read, and recovers on «Проверить ещё раз»', async () => {
    accessMock.seed('available')
    server.use(http.get(CONFIG, () => problem(503, { code: 'internal_error' }), { once: true }))
    await open()

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.configError)
    })
    expect(cta()?.getAttribute('aria-disabled')).toBeNull()
    cta()?.click()
    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.blocked)
    })
    expect(cta()?.textContent.trim()).toBe('Создать мой разбор')
  })

  it('shows «Проверяем доступ…» only when the answer is slow', async () => {
    accessMock.seed('available')
    let release: () => void = () => undefined
    server.use(
      http.get(SESSION, async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json(accessMock.session(), { headers: MOCK_HEADER })
      }),
    )
    await open()

    expect(status()).toBe('')
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.checking)
    })
    release()
    await vi.waitFor(() => {
      expect(status()).toBe('')
    })
  })
})

describe('ConsentView: blocked, the default (Q12 open)', () => {
  it('shows the summary and a neutral message, with no consent text, no checkbox and no cost line', async () => {
    accessMock.seed('available')
    await open()

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.blocked)
    })
    expect(checkbox()).toBeNull()
    expect(document.querySelector('.consent__cost')).toBeNull()
    expect(document.querySelector('.consent-test-text, [data-test-mode], a[href^="/legal"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Q12')
    expect(document.body.textContent).not.toContain('Тестовый режим')
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    expect(cta()?.getAttribute('aria-describedby')).toBe('consent-unavailable')
    expect(document.querySelector('[data-block="profile"] .consent__value')?.textContent.trim()).toBe('Тестовая Вега')
  })

  it('sends no POST /orders however the button is used', async () => {
    accessMock.seed('available')
    const orders = recordOrders()
    const { router } = await open()
    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.blocked)
    })

    cta()?.click()
    cta()?.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    cta()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(orders.keys).toEqual([])
    expect(router.currentRoute.value.path).toBe('/create/consent')
    expect(sessionStorage.getItem(ATTEMPT_KEY)).toBeNull()
    expect(ordersMock.orderCount()).toBe(0)
  })

  it('stays shut for a configuration that claims legal readiness outside the stand', async () => {
    accessMock.seed('available')
    const orders = recordOrders()
    server.use(http.get(CONFIG, () => HttpResponse.json(testCreationConfig())))
    await open()

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.blocked)
    })
    cta()?.click()
    await flushPromises()
    expect(checkbox()).toBeNull()
    expect(orders.keys).toEqual([])
  })

  it('stays shut with ?creation=test when the mocks are not switched on', async () => {
    window.history.replaceState(null, '', '/create/consent?creation=test')
    accessMock.seed('available')
    await open()

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.blocked)
    })
    expect(checkbox()).toBeNull()
    expect(document.body.textContent).not.toContain('Тестовый режим')
  })

  it('stays shut in a production build even with the stand configuration and ?creation=test', async () => {
    testMode()
    vi.stubEnv('DEV', false)
    accessMock.seed('available')
    const orders = recordOrders()
    await open()

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.blocked)
    })
    expect(checkbox()).toBeNull()
    expect(document.querySelector('[data-test-mode]')).toBeNull()
    cta()?.click()
    await flushPromises()
    expect(orders.keys).toEqual([])
    expect(ordersMock.orderCount()).toBe(0)
  })

  it('shows the generation message when features.generation is false (К11)', async () => {
    accessMock.seed('available')
    const orders = recordOrders()
    server.use(
      http.get(CONFIG, () =>
        HttpResponse.json({ ...testCreationConfig(), features: { ...publicConfig.features, generation: false } }, { headers: MOCK_HEADER }),
      ),
    )
    await open()

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.generationOff)
    })
    expect(checkbox()).toBeNull()
    cta()?.click()
    await flushPromises()
    expect(orders.keys).toEqual([])
  })
})

describe('ConsentView: the test mode (dev build, MSW, ?creation=test)', () => {
  beforeEach(() => {
    testMode()
    accessMock.seed('available')
  })

  it('shows the banner, the stand-in for the consent text, the cost line and an unchecked checkbox', async () => {
    await open()
    await ready()

    expect(document.querySelector('[data-test-mode]')?.textContent).toBe('Тестовый режим. Заказ создаётся на моке, юридический текст не утверждён.')
    expect(document.querySelector('label[for="consent-check"]')?.textContent.trim()).toBe('[Текст согласия появится после Q12]')
    expect(document.querySelector('#consent-cost')?.textContent).toBe('При создании заказа будет использован один доступ.')
    expect(checkbox()?.checked).toBe(false)
    expect(checkbox()?.getAttribute('aria-describedby')).toBe('consent-cost')
    expect(document.activeElement).toBe(heading())
    expect(document.querySelector('a[href^="/legal"]')).toBeNull()
    expect(cta()?.textContent.trim()).toBe('Создать мой разбор')
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    expect(document.querySelector('#consent-reason')?.textContent).toBe(consentTexts.needConsent)
    expect(cta()?.getAttribute('aria-describedby')).toBe('consent-reason')
  })

  it('sends nothing without the checkbox, by click or by Enter in the form', async () => {
    const orders = recordOrders()
    await open()
    await ready()

    cta()?.click()
    cta()?.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()

    expect(orders.keys).toEqual([])
    expect(ordersMock.orderCount()).toBe(0)
  })

  it('turns the button on with the checkbox and off again without it', async () => {
    await open()
    await ready()

    await agree()
    expect(cta()?.hasAttribute('aria-disabled')).toBe(false)
    await agree()
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
  })

  it('creates one order with the access, the profile and the version of the configuration, then opens SCR-06', async () => {
    const orders = recordOrders()
    const expected = toProfile(useIntakeDraft().draft)
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe(`/orders/${FIRST_ORDER}/creating`)
    })

    expect(expected).not.toBeNull()
    expect(orders.keys).toHaveLength(1)
    expect(orders.keys[0]).toMatch(/^[A-Za-z0-9_-]{16,80}$/)
    expect(orders.bodies[0]).toEqual({
      entitlement_id: ENTITLEMENT,
      profile: expected,
      consent_version: 'test-consent-v0',
    })
    expect(ordersMock.orderCount()).toBe(1)
    expect(accessMock.session()).toMatchObject({ entitlement: { state: 'consumed', order_id: FIRST_ORDER } })
  })

  it('clears the draft, the check and the key once the order is confirmed', async () => {
    const { router } = await open()
    await ready()
    await agree()
    expect(sessionStorage.getItem(ATTEMPT_KEY)).not.toBeNull()

    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order-creating')
    })

    expect(sessionStorage.getItem(ATTEMPT_KEY)).toBeNull()
    expect(sessionStorage.getItem('cosmos.intake.check.v1')).toBeNull()
    expect(useIntakeDraft().draft.name).toBe('')
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(document.querySelector('[data-block="profile"] .consent__value')?.textContent.trim()).toBe('Тестовая Вега')
  })

  it('sends one request for a double press, Enter and a repeated tap', async () => {
    const orders = recordOrders()
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    cta()?.click()
    cta()?.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order-creating')
    })

    expect(orders.keys).toHaveLength(1)
    expect(ordersMock.orderCount()).toBe(1)
  })

  it('locks the controls in flight and shows «Создаём заказ…» only when the answer is slow', async () => {
    let release: () => void = () => undefined
    server.use(
      http.post(ORDERS, async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }),
    )
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    await flushPromises()
    expect(status()).toBe('')
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    expect(buttonByText('Назад')?.getAttribute('aria-disabled')).toBe('true')
    expect(buttonByText('Изменить')?.getAttribute('aria-disabled')).toBe('true')
    expect(checkbox()?.getAttribute('aria-disabled')).toBe('true')

    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.submitting)
    })
    checkbox()?.click()
    buttonByText('Назад')?.click()
    buttonByText('Изменить')?.click()
    await flushPromises()
    expect(checkbox()?.checked).toBe(true)
    expect(router.currentRoute.value.path).toBe('/create/consent')

    release()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order-creating')
    })
  })

  it('keeps the full code out of the URL, storage, requests and the console', async () => {
    const log = vi.spyOn(console, 'log')
    const info = vi.spyOn(console, 'info')
    const warn = vi.spyOn(console, 'warn')
    const error = vi.spyOn(console, 'error')
    const orders = recordOrders()
    const { router } = await open()
    await ready()
    await agree()
    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order-creating')
    })

    const compact = syntheticCodes.available.replace(/-/g, '')
    for (const text of [router.currentRoute.value.fullPath, window.location.href, stored(), JSON.stringify(orders.bodies), orders.keys.join()]) {
      expect(text).not.toContain(syntheticCodes.available)
      expect(text).not.toContain(compact.slice(2))
    }
    for (const spy of [log, info, warn, error]) expect(spy).not.toHaveBeenCalled()
  })
})

describe('ConsentView: an unknown outcome (§0.7)', () => {
  beforeEach(() => {
    testMode()
    accessMock.seed('available')
  })

  it('reads the session first and opens SCR-06 when the order exists, without a second POST', async () => {
    ordersMock.inject('lost-response')
    const orders = recordOrders()
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe(`/orders/${FIRST_ORDER}/creating`)
    })

    expect(orders.keys).toHaveLength(1)
    expect(ordersMock.orderCount()).toBe(1)
  })

  it('shows «Проверяем, создан ли заказ…» while it reads the session', async () => {
    ordersMock.inject('lost-response')
    const { router } = await open()
    await ready()
    let release: () => void = () => undefined
    server.use(
      http.get(SESSION, async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json(accessMock.session(), { headers: MOCK_HEADER })
      }),
    )
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.recovering)
    })
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    release()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe(`/orders/${FIRST_ORDER}/creating`)
    })
  })

  it('offers a manual check with the same key when no order exists, and creates exactly once', async () => {
    ordersMock.inject('lost-request')
    const orders = recordOrders()
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.unknown)
    })
    expect(orders.keys).toHaveLength(1)
    expect(cta()?.textContent.trim()).toBe('Проверить ещё раз')
    expect(cta()?.hasAttribute('aria-disabled')).toBe(false)
    expect(document.activeElement).toBe(cta())
    expect(cta()?.getAttribute('aria-describedby')).toBe('consent-notice')
    expect(checkbox()?.checked).toBe(true)
    const key = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? '{}').key as string

    await flushPromises()
    expect(orders.keys).toEqual([key])
    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order-creating')
    })

    expect(orders.keys).toEqual([key, key])
    expect(ordersMock.orderCount()).toBe(1)
  })

  it('does not retry by itself and keeps the key across several failed checks', async () => {
    server.use(http.post(ORDERS, () => problem(503, { code: 'internal_error' })))
    const orders = recordOrders()
    await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.unknown)
    })
    const key = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? '{}').key as string
    cta()?.click()
    await vi.waitFor(() => {
      expect(orders.keys).toHaveLength(2)
    })
    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.unknown)
    })

    expect(orders.keys).toEqual([key, key])
    expect(ordersMock.orderCount()).toBe(0)
  })

  it('finds the order after a 5xx that came after the commit, by the session, not by a new POST', async () => {
    ordersMock.inject('error-after-commit')
    const orders = recordOrders()
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe(`/orders/${FIRST_ORDER}/creating`)
    })
    expect(orders.keys).toHaveLength(1)
  })

  it('keeps the same key for a retry after a reload', async () => {
    ordersMock.inject('lost-request')
    const orders = recordOrders()
    await open()
    await ready()
    await agree()
    cta()?.click()
    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.unknown)
    })
    const key = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? '{}').key as string
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''

    const { router } = await open()
    await ready()
    expect(JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? '{}').key).toBe(key)
    await agree()
    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order-creating')
    })
    expect(orders.keys).toEqual([key, key])
  })
})

describe('ConsentView: refusals keep the draft and the session (§0.8)', () => {
  beforeEach(() => {
    accessMock.seed('available')
  })

  async function submitted(extra = '') {
    testMode(extra)
    const orders = recordOrders()
    const opened = await open()
    await ready()
    await agree()
    cta()?.click()
    return { ...opened, orders }
  }

  function untouched() {
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
    expect(accessMock.session()).toMatchObject({ principal: 'code', entitlement: { state: 'available' } })
    expect(ordersMock.orderCount()).toBe(0)
  }

  it('asks for the consent again on consent_outdated, with a new key and the new version', async () => {
    const { orders } = await submitted('&orders=consent-outdated')

    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.consentOutdated)
    })
    expect(checkbox()?.checked).toBe(false)
    expect(document.activeElement).toBe(checkbox())
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    untouched()
    const renewed = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? '{}') as { key: string; consentVersion: string }
    expect(renewed.key).not.toBe(orders.keys[0])
    expect(renewed.consentVersion).not.toBe('test-consent-v0')

    await agree()
    cta()?.click()
    await vi.waitFor(() => {
      expect(ordersMock.orderCount()).toBe(1)
    })
    expect(orders.keys).toEqual([orders.keys[0], renewed.key])
    expect((orders.bodies[1] as { consent_version: string }).consent_version).toBe(renewed.consentVersion)
  })

  it('shows what the server said for a rate limit and holds the button for Retry-After', async () => {
    const { orders } = await submitted('&orders=rate-limited')

    await vi.waitFor(() => {
      expect(status()).toBe('Слишком много попыток. Подожди минуту и попробуй снова.')
    })
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(cta())
    cta()?.click()
    await flushPromises()
    expect(orders.keys).toHaveLength(1)
    untouched()
  })

  it('offers «Проверить и изменить» for a profile the server refuses, and the access stays available', async () => {
    const { router } = await submitted('&orders=nonexistent')

    await vi.waitFor(() => {
      expect(buttonByText('Проверить и изменить')).toBeDefined()
    })
    expect(status().length).toBeGreaterThan(0)
    expect(status()).not.toContain('Доступ не использован')
    untouched()
    buttonByText('Проверить и изменить')?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/review')
    })
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })

  it('says the access was not used only for a failed calculation, and allows a retry with the same key', async () => {
    const { orders } = await submitted('&orders=calculation-failed')

    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.calculationFailed)
    })
    expect(document.activeElement).toBe(cta())
    expect(cta()?.hasAttribute('aria-disabled')).toBe(false)
    untouched()

    cta()?.click()
    await vi.waitFor(() => {
      expect(orders.keys).toHaveLength(2)
    })
    expect(orders.keys[1]).toBe(orders.keys[0])
  })

  it('opens the existing order when another tab used the access first', async () => {
    const { router } = await submitted('&orders=used')

    await vi.waitFor(() => {
      expect(buttonByText('Открыть разбор')).toBeDefined()
    })
    expect(slotText()).toBe(consentTexts.entitlementUsed)
    expect(checkbox()).toBeNull()
    expect(document.activeElement).toBe(cta())
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')

    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order')
    })
    expect(router.currentRoute.value.params.id).toBe(FIRST_ORDER)
    expect(ordersMock.orderCount()).toBe(1)
  })

  it('says the code is unavailable when it was blocked in between, and creates nothing', async () => {
    await submitted('&orders=blocked')

    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.entitlementBlocked)
    })
    expect(checkbox()).toBeNull()
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    expect(ordersMock.orderCount()).toBe(0)
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })

  it('returns to the access when the session has ended, the draft saved', async () => {
    testMode()
    server.use(http.post(ORDERS, () => problem(401, { code: 'unauthenticated' })))
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/create/access')
    })
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })

  it('closes creation when the server says it is not available', async () => {
    testMode()
    server.use(http.post(ORDERS, () => problem(403, { code: 'creation_unavailable' })))
    await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(slotText()).toBe(consentTexts.blocked)
    })
    expect(checkbox()).toBeNull()
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    expect(useIntakeDraft().draft.name).toBe('Тестовая Вега')
  })

  it('takes a new key and asks for one more manual try after idempotency_key_reused', async () => {
    testMode()
    const orders = recordOrders()
    server.use(http.post(ORDERS, () => problem(409, { code: 'idempotency_key_reused' }), { once: true }))
    const { router } = await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(status()).toBe(consentTexts.failed)
    })
    const renewed = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? '{}').key as string
    expect(orders.keys).toHaveLength(0)

    cta()?.click()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('order-creating')
    })
    expect(orders.keys).toEqual([renewed])
  })

  it('reads a 404 for a foreign access as a stale session and reads it again', async () => {
    testMode()
    let reads = 0
    server.use(
      http.get(SESSION, () => {
        reads += 1
      }),
      http.post(ORDERS, () => problem(404, { code: 'not_found' }), { once: true }),
    )
    await open()
    await ready()
    await agree()

    cta()?.click()
    await vi.waitFor(() => {
      expect(reads).toBe(2)
    })
    await ready()
    expect(checkbox()?.checked).toBe(false)
    expect(cta()?.getAttribute('aria-disabled')).toBe('true')
    untouched()
  })
})
