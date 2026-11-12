import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// SCR-04 (slice 5): «Доступ» on MSW mocks. Codes are the synthetic ones of
// frontend/src/mocks/access.ts; every answer below is synthetic.

const DRAFT_KEY = 'cosmos.intake.v1'

const codes = {
  available: 'LK-FREE0-00000-00000-00000-0F001',
  availableOther: 'LK-FREE0-00000-00000-00000-0F002',
  consumed: 'LK-SPENT-00000-00000-00000-0S001',
  unknown: 'LK-ZZZZZ-00000-00000-00000-0Z001',
} as const

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

/** Everything the page sends or prints, to prove the code stays in memory. */
function watch(page: Page) {
  const logins: unknown[] = []
  const forbidden: string[] = []
  const urls: string[] = []
  const console: string[] = []
  const errors: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/code')) logins.push(request.postDataJSON())
    if (/\/api\/v1\/(orders|entitlements|activations)/.test(request.url())) forbidden.push(request.url())
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })
  page.on('console', (message) => console.push(message.text()))
  page.on('pageerror', (error) => errors.push(error.message))
  return { logins, forbidden, urls, console, errors }
}

/** The visitor's way in: the review checks the profile, «Продолжить» opens access. */
async function reachAccess(page: Page) {
  await seedDraft(page)
  await page.goto('/create/review?scene=freeze')
  await expect(page.getByRole('status')).toHaveText('Данные проверены.')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page).toHaveURL('/create/access')
}

/** A reload of access in the same tab: the check survives, the mock session does not. */
async function reloadAccess(page: Page, query = '') {
  await page.goto(`/create/access?scene=freeze${query}`)
  await expect(page).toHaveURL(/\/create\/access/)
}

const field = (page: Page) => page.getByRole('textbox', { name: 'Код доступа' })
const check = (page: Page) => page.getByRole('button', { name: 'Проверить код' })
const sessionLine = (page: Page) => page.locator('.access__value')

async function enter(page: Page, code: string) {
  await field(page).fill(code)
  await check(page).click()
}

/** Another tab opens a code after this screen has read an anonymous session. */
async function openElsewhere(page: Page, code: string) {
  await expect(field(page)).toBeVisible()
  await page.evaluate(async (value) => {
    await fetch('/api/v1/auth/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: value }) })
  }, code)
}

async function storedEverywhere(page: Page) {
  return page.evaluate(() =>
    [sessionStorage, localStorage].flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ''}`)).join('\n') + `\n${document.cookie}`,
  )
}

function expectNoCode(seen: ReturnType<typeof watch>, stored: string, values: readonly string[]) {
  for (const value of values) {
    const compact = value.replace(/-/g, '')
    for (const url of seen.urls) expect(decodeURIComponent(url)).not.toContain(compact.slice(2))
    expect(stored).not.toContain(value)
    expect(stored).not.toContain(compact)
    for (const line of seen.console) expect(line).not.toContain(value)
  }
}

test('E2E-04: a free code is accepted, the field is wiped and «Продолжить» opens consent without an order', async ({ page }) => {
  const seen = watch(page)
  await reachAccess(page)

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Остался доступ к персональному разбору.')
  await expect(field(page)).toBeFocused()
  await enter(page, codes.available)

  await expect(sessionLine(page)).toContainText('Код ••••F001 принят.')
  await expect(field(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeFocused()
  expect(seen.logins).toEqual([{ code: codes.available }])

  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page).toHaveURL('/create/consent')
  expect(seen.forbidden).toEqual([])
  expect(seen.errors).toEqual([])
  expectNoCode(seen, await storedEverywhere(page), [codes.available])
})

test('a used code opens its reading and keeps the profile', async ({ page }) => {
  const seen = watch(page)
  await reachAccess(page)
  await enter(page, codes.consumed)

  await expect(sessionLine(page)).toContainText('По этому коду уже создан разбор.')
  await expect(page.getByText('Твоя анкета сохранится для другого кода.')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть разбор' }).click()
  await expect(page).toHaveURL('/orders/00000000-0000-4000-8000-0000000d0001')
  expect(seen.forbidden).toEqual([])
  expect(await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY)).toContain('Анна')
})

test('MOT-03: a refused code stays in the field with the error under it, and nothing is stored', async ({ page }) => {
  const seen = watch(page)
  await reachAccess(page)
  await enter(page, codes.unknown)

  await expect(page.locator('.field__message--error')).toHaveText('Этот код не подходит. Проверь, что он введён полностью, или напиши в поддержку.')
  await expect(field(page)).toHaveValue(codes.unknown)
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true')
  await expect(field(page)).toBeFocused()
  expectNoCode(seen, await storedEverywhere(page), [codes.unknown])
})

test('a double press sends one request; a slow check shows its status', async ({ page }) => {
  const seen = watch(page)
  await reachAccess(page)
  await reloadAccess(page, '&auth-code=slow')
  await field(page).fill(codes.available)
  await check(page).dblclick()
  await expect(page.getByRole('status')).toHaveText('Проверяем код…')
  await expect(check(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(sessionLine(page)).toContainText('принят', { timeout: 5000 })
  expect(seen.logins).toHaveLength(1)
})

test('А8: another code opened elsewhere is replaced only after «Заменить», from the keyboard', async ({ page }) => {
  const seen = watch(page)
  await reachAccess(page)
  await openElsewhere(page, codes.available)
  await enter(page, codes.availableOther)

  const replace = page.getByRole('button', { name: 'Заменить' })
  await expect(page.getByText('В этом браузере уже открыт другой код (••••F001).')).toBeVisible()
  await expect(replace).toBeFocused()
  await expect(field(page)).toHaveValue(codes.availableOther)
  await page.keyboard.press('Enter')

  await expect(sessionLine(page)).toContainText('Код ••••F002 принят.')
  expect(seen.logins.slice(-2)).toEqual([{ code: codes.availableOther }, { code: codes.availableOther, replace_session: true }])
})

test('А8: «Оставить текущий» keeps the open code', async ({ page }) => {
  await reachAccess(page)
  await openElsewhere(page, codes.available)
  await enter(page, codes.availableOther)
  await page.getByRole('button', { name: 'Оставить текущий' }).click()
  await expect(sessionLine(page)).toContainText('Код ••••F001 уже принят.')
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeFocused()
})

test('an open session is shown instead of the field; «Использовать другой код» → «Отмена» returns to it', async ({ page }) => {
  const seen = watch(page)
  await reachAccess(page)
  await reloadAccess(page, '&session=code-available')

  await expect(sessionLine(page)).toContainText('Код ••••F001 уже принят.')
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await page.getByRole('button', { name: 'Использовать другой код' }).click()
  await expect(field(page)).toBeFocused()
  await expect(page.getByText('закроется в этом браузере. Его можно будет ввести снова.')).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(sessionLine(page)).toContainText('уже принят')
  expect(seen.logins).toEqual([])
})

test('keyboard: Tab order follows the screen in entry, accepted and conflict states', async ({ page }) => {
  await reachAccess(page)
  const active = () => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.id ? `#${el.id}` : (el?.innerText.trim() ?? '')
  })

  await expect(field(page)).toBeFocused()
  const entry: string[] = []
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Tab')
    entry.push(await active())
  }
  expect(entry.slice(0, 2)).toEqual(['Проверить код', 'Назад'])
  expect(entry[2]).not.toContain('Где получить код')

  await field(page).focus()
  await page.keyboard.type(codes.available)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await active()).toBe('Использовать другой код')

  await page.keyboard.press('Enter')
  await expect(field(page)).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await active()).toBe('Отмена')
})

test('a long code scrolls inside the one-line field: the caret and the last symbols stay visible', async ({ page }) => {
  await reachAccess(page)
  const box = field(page)
  const view = () => box.evaluate((el: HTMLInputElement) => ({ left: el.scrollLeft, width: el.clientWidth, full: el.scrollWidth, caret: el.selectionStart }))
  // Chrome scrolls a text field to its caret on the next frame, so the view is polled.
  const atEnd = () => expect.poll(async () => {
    const v = await view()
    return v.left + v.width >= v.full - 2
  }).toBe(true)

  // macOS text fields move to the line ends with ⌘←/⌘→, not Home/End.
  const [home, end] = process.platform === 'darwin' ? ['Meta+ArrowLeft', 'Meta+ArrowRight'] : ['Home', 'End']

  await box.pressSequentially(codes.available)
  expect((await view()).full).toBeGreaterThan((await view()).width)
  await atEnd()

  await page.keyboard.press(home)
  await expect.poll(async () => (await view()).left).toBe(0)
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Delete')
  await page.keyboard.type('X')
  await expect(box).toHaveValue('LK-FRXE0-00000-00000-00000-0F001')
  expect((await view()).caret).toBe(6)

  await page.keyboard.press(end)
  await atEnd()

  await page.keyboard.press(home)
  await page.keyboard.press('Tab')
  await atEnd()
})

for (const [state, prepare] of [
  ['entry', async () => undefined],
  ['field error', async (page: Page) => {
    await enter(page, codes.unknown)
    await expect(page.locator('.field__message--error')).toBeVisible()
  }],
  ['accepted', async (page: Page) => {
    await enter(page, codes.available)
    await expect(sessionLine(page)).toContainText('принят')
  }],
  ['used', async (page: Page) => {
    await enter(page, codes.consumed)
    await expect(page.getByRole('button', { name: 'Открыть разбор' })).toBeVisible()
  }],
  ['conflict', async (page: Page) => {
    await openElsewhere(page, codes.available)
    await enter(page, codes.availableOther)
    await expect(page.getByRole('button', { name: 'Заменить' })).toBeVisible()
  }],
] as const) {
  test(`access (${state}) has no serious accessibility violations`, async ({ page }) => {
    await reachAccess(page)
    await prepare(page)
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.effect?.getTiming().iterations === Infinity))
    const results = await new AxeBuilder({ page }).exclude('[data-testid="dev-panel"]').analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}

test('the guard: no check or a changed answer goes back to the review', async ({ page }) => {
  await seedDraft(page)
  await page.goto('/create/access')
  await expect(page).toHaveURL('/create/review')
  await expect(page.getByRole('status')).toHaveText('Данные проверены.')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page).toHaveURL('/create/access')

  await page.goto('/create?step=name&from=review')
  await page.getByLabel('Имя', { exact: true }).fill('Вера')
  await page.goto('/create/access')
  await expect(page).toHaveURL('/create/review')
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('access enters with a fade, the camera stays and the accent line is not drawn', async ({ page }) => {
    await seedDraft(page)
    await page.goto('/create/review')
    await expect(page.getByRole('status')).toHaveText('Данные проверены.')
    const scene = page.locator('.cosmos-scene')
    await page.getByRole('button', { name: 'Продолжить' }).click()
    await expect(page).toHaveURL('/create/access')
    await expect(scene).toHaveAttribute('data-scene-composition', 'access')
    expect(await scene.getAttribute('data-scene-moving')).toBe('false')
    expect(await page.locator('.access__column').evaluate((el) => getComputedStyle(el).animationName)).toMatch(/^access-fade/)

    await enter(page, codes.available)
    await expect(sessionLine(page)).toContainText('принят')
    expect(await sessionLine(page).evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('none')
  })
})

test('without WebGL access works on the poster', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      return String(args[0]).startsWith('webgl') ? null : getContext.apply(this, args)
    } as typeof getContext
  })
  await reachAccess(page)
  const scene = page.locator('.cosmos-scene')
  await expect(scene).toHaveAttribute('data-scene-state', /^(poster|fallback)$/)
  await expect(scene.locator('.scene-poster img')).toBeVisible()
  await enter(page, codes.available)
  await expect(sessionLine(page)).toContainText('принят')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page).toHaveURL('/create/consent')
})

test.describe('phone with an on-screen keyboard', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the heading keeps focus; with the keyboard up the field, its message and «Проверить код» stay above it', async ({ page }) => {
    await reachAccess(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)

    // ≈330 px of keyboard: the visual viewport shrinks before the field scrolls into view.
    await page.setViewportSize({ width: 390, height: 514 })
    await field(page).tap()
    await page.waitForTimeout(700)
    await expect(field(page)).toBeInViewport({ ratio: 1 })
    await expect(page.locator('.field__message')).toBeInViewport({ ratio: 1 })
    await expect(check(page)).toBeInViewport({ ratio: 1 })

    await field(page).fill(codes.available)
    await check(page).tap()
    await expect(sessionLine(page)).toContainText('принят')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  })
})
