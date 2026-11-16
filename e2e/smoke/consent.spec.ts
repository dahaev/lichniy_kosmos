import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// SCR-05 (slice 6): «Подтверждение согласия» on MSW mocks. Real creation is shut
// until Q12, so the full scenario runs only in the explicit test mode of the
// stand (`?creation=test`); every other visit must never send `POST /orders`.
// Every answer below is synthetic.

const DRAFT_KEY = 'cosmos.intake.v1'
const ATTEMPT_KEY = 'cosmos.order.attempt.v1'
const ORDER_URL = /\/orders\/00000000-0000-4000-8000-[0-9a-f]{12}\/creating$/

const complete = {
  version: 1,
  step: 'time',
  name: 'Анна',
  date: { day: '12', month: '03', year: '1990' },
  place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
  time: { kind: 'known', hhmm: '14:30', source: 'document', accuracy: 0, accuracyTouched: false },
}

async function seedDraft(page: Page) {
  await page.addInitScript(
    ([key, draft]) => {
      if (sessionStorage.getItem('e2e.seeded')) return
      sessionStorage.setItem('e2e.seeded', '1')
      sessionStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() }))
    },
    [DRAFT_KEY, complete] as const,
  )
}

interface Order {
  key: string | null
  body: Record<string, unknown>
}

/** Everything the page sends in order, to prove how many orders were asked for and what came first. */
function watch(page: Page) {
  const orders: Order[] = []
  const calls: string[] = []
  const urls: string[] = []
  const console: string[] = []
  const errors: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (!pathname.startsWith('/api/v1/')) return
    calls.push(`${request.method()} ${pathname.replace('/api/v1', '')}`)
    if (request.method() === 'POST' && pathname === '/api/v1/orders') {
      orders.push({ key: request.headers()['idempotency-key'] ?? null, body: request.postDataJSON() as Record<string, unknown> })
    }
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })
  page.on('console', (message) => console.push(message.text()))
  page.on('pageerror', (error) => errors.push(error.message))
  return { orders, calls, urls, console, errors }
}

/** The visitor's way in: the review checks the profile; the mock session is then opened by `?session`. */
async function reachConsent(page: Page, query = '', session = 'code-available') {
  await seedDraft(page)
  await page.goto('/create/review?scene=freeze')
  await expect(page.getByRole('status')).toHaveText('Данные проверены.')
  await page.goto(`/create/consent?scene=freeze&session=${session}${query}`)
  await expect(page).toHaveURL(/\/create\/consent/)
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
}

const test_ = '&creation=test'
const create = (page: Page) => page.getByRole('button', { name: /^(Создать мой разбор|Проверить ещё раз|Открыть разбор)$/ })
const agree = (page: Page) => page.getByRole('checkbox')
const status = (page: Page) => page.getByRole('status')
const back = (page: Page) => page.getByRole('button', { name: 'Назад' })

/** Waits for the open state after the entrance and the slot's cross-fade. */
async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.effect?.getTiming().iterations === Infinity))
}

async function storedEverywhere(page: Page) {
  return page.evaluate(
    () => [sessionStorage, localStorage].flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ''}`)).join('\n') + `\n${document.cookie}`,
  )
}

async function readyToCreate(page: Page, query = '') {
  await reachConsent(page, `${test_}${query}`)
  await expect(agree(page)).toBeVisible()
  await expect(create(page)).toHaveAttribute('aria-disabled', 'true')
}

test.describe('closed by default (legal_ready=false)', () => {
  test('blocked: the summary stays, the message replaces the confirmation and no action sends an order', async ({ page }) => {
    const seen = watch(page)
    await reachConsent(page)

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Последний шаг')
    await expect(page.getByText('Анна', { exact: true })).toBeVisible()
    await expect(page.getByText('12 марта 1990 · Казань · 14:30')).toBeVisible()
    await expect(page.locator('[data-block="access"]')).toContainText('Код ••••F001')
    await expect(page.getByText('Создание разбора пока недоступно.')).toBeVisible()
    await expect(agree(page)).toHaveCount(0)
    await expect(page.locator('[data-test-mode]')).toHaveCount(0)
    await expect(page.getByText('Текст согласия появится')).toHaveCount(0)
    await expect(create(page)).toHaveAttribute('aria-disabled', 'true')

    // Playwright treats aria-disabled as not actionable; the user can still press it.
    const button = create(page)
    await button.click({ force: true })
    await button.dblclick({ force: true })
    await button.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await page.waitForTimeout(400)

    expect(seen.orders).toEqual([])
    expect(seen.calls).not.toContain('POST /orders')
    expect(page.url()).toContain('/create/consent')
    expect(seen.errors).toEqual([])
  })

  test('the test switches in the URL do not open creation without the explicit test mode', async ({ page }) => {
    const seen = watch(page)
    await reachConsent(page, '&orders=slow&consent=test&legal_ready=true&generation=true&test=1')
    await expect(page.getByText('Создание разбора пока недоступно.')).toBeVisible()
    await expect(agree(page)).toHaveCount(0)
    await create(page).click({ force: true })
    expect(seen.orders).toEqual([])
  })
})

test.describe('test mode of the stand', () => {
  test('E2E-06: a free code, the consent and one order: one request, one spent access, the draft and the key cleared', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page)

    await expect(page.locator('[data-test-mode]')).toHaveText('Тестовый режим. Заказ создаётся на моке, юридический текст не утверждён.')
    await expect(page.getByText('[Текст согласия появится после Q12]')).toBeVisible()
    await expect(page.getByText('При создании заказа будет использован один доступ.', { exact: true })).toBeVisible()
    await expect(agree(page)).not.toBeChecked()
    await expect(agree(page)).not.toBeFocused()
    await expect(page.getByRole('link', { name: /Условия|Политика/ })).toHaveCount(0)
    expect(await storedEverywhere(page)).toContain(ATTEMPT_KEY)

    await agree(page).check()
    await expect(create(page)).not.toHaveAttribute('aria-disabled', 'true')
    await create(page).click()

    await expect(page).toHaveURL(ORDER_URL)
    expect(seen.orders).toHaveLength(1)
    const [order] = seen.orders as [Order]
    expect(order.key).toMatch(/^[A-Za-z0-9_-]{16,80}$/)
    expect(Object.keys(order.body).sort()).toEqual(['consent_version', 'entitlement_id', 'profile'])
    expect(order.body.consent_version).toBe('test-consent-v0')
    expect(order.body).not.toHaveProperty('code')

    const stored = await storedEverywhere(page)
    expect(stored).not.toContain(DRAFT_KEY)
    expect(stored).not.toContain(ATTEMPT_KEY)
    expect(stored).not.toContain('LK-')
    for (const url of seen.urls) expect(url).not.toMatch(/LK-|F001|FREE0/i)
    for (const line of seen.console) expect(line).not.toMatch(/LK-FREE0|Идемпотент/i)

    // The access is spent once: the session now points at the order.
    const session = await page.evaluate(async () => (await fetch('/api/v1/session')).json() as Promise<{ entitlement: { state: string; order_id: string } }>)
    expect(session.entitlement.state).toBe('consumed')
    expect(page.url()).toContain(session.entitlement.order_id)
    expect(seen.errors).toEqual([])
  })

  test('without the consent no order leaves: a click and Enter on the inactive button send nothing', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page)

    await create(page).click({ force: true })
    await create(page).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await page.waitForTimeout(400)
    expect(seen.orders).toEqual([])
    expect(page.url()).toContain('/create/consent')

    await agree(page).check()
    await agree(page).uncheck()
    await expect(create(page)).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Enter')
    expect(seen.orders).toEqual([])
  })

  test('the consent is asked again on every visit and the key of the attempt is kept', async ({ page }) => {
    await readyToCreate(page)
    await agree(page).check()
    const key = await page.evaluate((k) => (JSON.parse(sessionStorage.getItem(k) ?? '{}') as { key: string }).key, ATTEMPT_KEY)
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,80}$/)

    await page.reload()
    await expect(agree(page)).toBeVisible()
    await expect(agree(page)).not.toBeChecked()
    await expect(create(page)).toHaveAttribute('aria-disabled', 'true')
    expect(await page.evaluate((k) => (JSON.parse(sessionStorage.getItem(k) ?? '{}') as { key: string }).key, ATTEMPT_KEY)).toBe(key)
    expect(await storedEverywhere(page)).not.toMatch(/LK-FREE0/)
  })

  test('a double click, a double Enter and a double tap on the slow request send one order and show the status', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page, '&orders=slow')
    await agree(page).check()
    await create(page).dblclick()
    await expect(status(page)).toHaveText('Создаём заказ…')
    await create(page).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect(create(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(create(page)).toBeFocused()
    await expect(agree(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(back(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('button', { name: 'Изменить данные анкеты' })).toHaveAttribute('aria-disabled', 'true')

    // While the request is in the air the controls ignore their action.
    await agree(page).click({ force: true })
    await back(page).click({ force: true })
    await expect(page).toHaveURL(/\/create\/consent/)

    await expect(page).toHaveURL(ORDER_URL, { timeout: 6000 })
    expect(seen.orders).toHaveLength(1)
  })

  test('the lost answer: the session is read first, no second order is asked for and the access is spent once', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page, '&orders=timeout')
    await agree(page).check()
    await create(page).click()

    await expect(page).toHaveURL(ORDER_URL)
    expect(seen.orders).toHaveLength(1)
    const afterPost = seen.calls.slice(seen.calls.indexOf('POST /orders') + 1)
    expect(afterPost[0]).toBe('GET /session')
    expect(afterPost.filter((call) => call.startsWith('POST'))).toEqual([])
    expect(seen.errors).toEqual([])
  })

  test('503 after the commit is recovered by the session read, with a single order', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page, '&orders=error-after')
    await agree(page).check()
    await create(page).click()
    await expect(page).toHaveURL(ORDER_URL)
    expect(seen.orders).toHaveLength(1)
  })

  test('the lost request: «Проверить ещё раз» repeats the order with the same key and never retries by itself', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page, '&orders=drop')
    await agree(page).check()
    await create(page).click()

    await expect(status(page)).toContainText('Заказ мог быть создан')
    await expect(create(page)).toHaveText(/Проверить ещё раз/)
    await expect(create(page)).toBeFocused()
    await expect(create(page)).toHaveAttribute('aria-describedby', 'consent-notice')
    await page.waitForTimeout(600)
    expect(seen.orders).toHaveLength(1)
    const [lost] = seen.orders as [Order]
    const afterLost = seen.calls.slice(seen.calls.indexOf('POST /orders') + 1)
    expect(afterLost).toEqual(['GET /session'])

    await create(page).click()
    await expect(page).toHaveURL(ORDER_URL)
    expect(seen.orders).toHaveLength(2)
    expect(seen.orders[1]?.key).toBe(lost.key)
  })

  test('a refused request keeps the data and the key; the error stands under the button', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page, '&orders=calculation-failed')
    await agree(page).check()
    const before = await page.evaluate((k) => sessionStorage.getItem(k), ATTEMPT_KEY)
    await create(page).click()

    await expect(status(page)).toHaveText('Не удалось рассчитать карту. Доступ не использован. Попробуй ещё раз.')
    await expect(create(page)).toBeFocused()
    expect(await page.evaluate((k) => sessionStorage.getItem(k), ATTEMPT_KEY)).toBe(before)
    expect(await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY)).toContain('Анна')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(seen.orders).toHaveLength(1)
  })

  test('consent_outdated: the checkbox is cleared and focused, the key is renewed', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page, '&orders=consent-outdated')
    await agree(page).check()
    const before = await page.evaluate((k) => (JSON.parse(sessionStorage.getItem(k) ?? '{}') as { key: string }).key, ATTEMPT_KEY)
    await create(page).click()

    await expect(status(page)).toHaveText('Условия обновились. Отметь согласие ещё раз.')
    await expect(agree(page)).toBeFocused()
    await expect(agree(page)).not.toBeChecked()
    await expect(create(page)).toHaveAttribute('aria-disabled', 'true')
    const after = await page.evaluate((k) => (JSON.parse(sessionStorage.getItem(k) ?? '{}') as { key: string }).key, ATTEMPT_KEY)
    expect(after).not.toBe(before)
    expect(seen.orders).toHaveLength(1)
  })

  test('entitlement_used: «Открыть разбор» is focused and opens the order that already exists', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page, '&orders=used')
    await agree(page).check()
    await create(page).click()

    await expect(page.getByText('По этому доступу уже создан разбор.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Открыть разбор' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/orders\/00000000-0000-4000-8000-[0-9a-f]{12}$/)
    expect(seen.orders).toHaveLength(1)
  })

  test('«Назад» keeps the draft and the code session; «Изменить» opens the review', async ({ page }) => {
    const seen = watch(page)
    await readyToCreate(page)
    await back(page).click()
    await expect(page).toHaveURL('/create/access')
    expect(await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY)).toContain('Анна')
    await expect(page.locator('.access__value')).toContainText('Код ••••F001 уже принят.')

    await reachConsent(page, test_)
    await page.getByRole('button', { name: 'Изменить данные анкеты' }).click()
    await expect(page).toHaveURL('/create/review')
    expect(seen.orders).toEqual([])
  })
})

test('the guard: an unchecked profile goes to the review, an anonymous visitor to the code, a spent access to its order', async ({ page }) => {
  await seedDraft(page)
  await page.goto('/create/consent')
  await expect(page).toHaveURL('/create/review')

  await expect(page.getByRole('status')).toHaveText('Данные проверены.')
  await page.goto('/create/consent?scene=freeze')
  await expect(page).toHaveURL('/create/access')
  expect(await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY)).toContain('Анна')

  await page.goto('/create/consent?scene=freeze&session=code-consumed')
  await expect(page).toHaveURL('/orders/00000000-0000-4000-8000-0000000d0001')
})

test('the session or the configuration cannot be read: creation stays shut and «Проверить ещё раз» reads again', async ({ page }) => {
  const seen = watch(page)
  await reachConsent(page, '', 'error')
  await expect(page.getByText('Не удалось проверить условия создания. Проверь соединение и попробуй ещё раз.')).toBeVisible()
  await expect(create(page)).toHaveText(/Проверить ещё раз/)
  await expect(agree(page)).toHaveCount(0)
  expect(seen.orders).toEqual([])
})

test('keyboard: Tab order follows the screen and the checkbox does not take focus by itself', async ({ page }) => {
  await readyToCreate(page)
  const active = () => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.getAttribute('aria-label') || el?.getAttribute('role') || (el?.tagName === 'INPUT' ? `input:${(el as HTMLInputElement).type}` : (el?.innerText.trim() ?? ''))
  })

  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  // Focus starts on the heading: «На главную» is the one stop before it.
  await page.keyboard.press('Shift+Tab')
  const order = [await active()]
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab')
    order.push(await active())
  }
  expect(order[0]).toContain('На главную')
  expect(order.slice(1, 5)).toEqual(['Изменить данные анкеты', 'input:checkbox', 'Создать мой разбор', 'Назад'])
  expect(order[5]).toContain('Замедлись')

  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await expect(agree(page)).toBeChecked()
  await page.keyboard.press('Tab')
  await expect(create(page)).toBeFocused()
  await expect(create(page)).not.toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Space')
  await expect(agree(page)).not.toBeChecked()
})

test('keyboard: Enter on the focused active button creates the order once', async ({ page }) => {
  const seen = watch(page)
  await readyToCreate(page)
  await agree(page).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(ORDER_URL)
  expect(seen.orders).toHaveLength(1)
})

test('the blocked state keeps the button in the Tab order and tells the reason', async ({ page }) => {
  await reachConsent(page)
  await create(page).focus()
  await expect(create(page)).toBeFocused()
  await expect(create(page)).toHaveAttribute('aria-describedby', 'consent-unavailable')
  await expect(page.locator('#consent-unavailable')).toHaveText('Создание разбора пока недоступно.')
})

const states: [string, (page: Page) => Promise<void>][] = [
  ['blocked', async (page) => reachConsent(page)],
  ['test, consent not given', async (page) => readyToCreate(page)],
  ['test, consent given', async (page) => {
    await readyToCreate(page)
    await agree(page).check()
  }],
  ['unknown outcome', async (page) => {
    await readyToCreate(page, '&orders=drop')
    await agree(page).check()
    await create(page).click()
    await expect(page.getByText(/Заказ мог быть создан/)).toBeVisible()
  }],
  ['refused (422 calculation)', async (page) => {
    await readyToCreate(page, '&orders=calculation-failed')
    await agree(page).check()
    await create(page).click()
    await expect(page.getByText(/Не удалось рассчитать карту/)).toBeVisible()
  }],
  ['rate limited', async (page) => {
    await readyToCreate(page, '&orders=rate-limited')
    await agree(page).check()
    await create(page).click()
    await expect(page.getByText(/Слишком много попыток/)).toBeVisible()
  }],
  ['access already used', async (page) => {
    await readyToCreate(page, '&orders=used')
    await agree(page).check()
    await create(page).click()
    await expect(page.getByRole('button', { name: 'Открыть разбор' })).toBeVisible()
  }],
  ['config error', async (page) => {
    await reachConsent(page, '', 'error')
    await expect(page.getByText(/Не удалось проверить условия/)).toBeVisible()
  }],
]

for (const [state, prepare] of states) {
  test(`consent (${state}) has no serious accessibility violations`, async ({ page }) => {
    await prepare(page)
    await settled(page)
    const results = await new AxeBuilder({ page }).exclude('[data-testid="dev-panel"]').analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('consent enters with a fade, the camera stays, the line and the tick are not drawn, and the order still goes through', async ({ page }) => {
    const seen = watch(page)
    await seedDraft(page)
    await page.goto('/create/review')
    await expect(status(page)).toHaveText('Данные проверены.')
    await page.goto(`/create/consent?session=code-available${test_}&orders=slow`)
    const scene = page.locator('.cosmos-scene')
    await expect(scene).toHaveAttribute('data-scene-composition', 'access')
    expect(await scene.getAttribute('data-scene-moving')).toBe('false')
    expect(await page.locator('.consent__column').evaluate((el) => getComputedStyle(el).animationName)).toMatch(/^consent-fade/)

    await expect(agree(page)).toBeVisible()
    await agree(page).check()
    expect(await page.locator('.consent__box').evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s/)
    await create(page).click()
    await expect(status(page)).toHaveText('Создаём заказ…')
    expect(await page.locator('.consent__pulse').count()).toBe(1)
    expect(await page.locator('.consent__pulse').evaluate((el) => getComputedStyle(el).display)).toBe('none')
    await expect(page).toHaveURL(ORDER_URL, { timeout: 6000 })
    expect(seen.orders).toHaveLength(1)
  })
})

test.describe('layout', () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 320, height: 640 },
    { width: 768, height: 1024 },
  ]) {
    test(`no horizontal scroll and a reachable button at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await readyToCreate(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
      await create(page).scrollIntoViewIfNeeded()
      await expect(create(page)).toBeInViewport({ ratio: 1 })
      await expect(page.getByText('При создании заказа будет использован один доступ.', { exact: true })).toBeVisible()
      const box = await agree(page).boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    })
  }
})

test('without WebGL consent works on the poster and creates one order', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      return String(args[0]).startsWith('webgl') ? null : getContext.apply(this, args)
    } as typeof getContext
  })
  const seen = watch(page)
  await readyToCreate(page)
  const scene = page.locator('.cosmos-scene')
  await expect(scene).toHaveAttribute('data-scene-state', /^(poster|fallback)$/)
  await expect(scene.locator('.scene-poster img')).toBeVisible()
  await agree(page).check()
  await create(page).click()
  await expect(page).toHaveURL(ORDER_URL)
  expect(seen.orders).toHaveLength(1)
})
