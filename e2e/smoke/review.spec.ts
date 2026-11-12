import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// SCR-03 (slice V2): «Проверка данных» on MSW mocks. Every answer below is synthetic.

const DRAFT_KEY = 'cosmos.intake.v1'

const complete = {
  version: 1,
  step: 'time',
  name: 'Анна',
  date: { day: '12', month: '03', year: '1990' },
  place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
  time: { kind: 'known', hhmm: '14:30', source: 'document', accuracy: 0, accuracyTouched: false },
}

async function seedDraft(page: Page, value: object) {
  await page.addInitScript(
    ([key, draft]) => {
      if (sessionStorage.getItem('e2e.seeded')) return
      sessionStorage.setItem('e2e.seeded', '1')
      sessionStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() }))
    },
    [DRAFT_KEY, value] as const,
  )
}

function storedDraft(page: Page) {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? 'null') as Record<string, unknown> | null, DRAFT_KEY)
}

function watchRequests(page: Page) {
  const checks: unknown[] = []
  const forbidden: string[] = []
  const urls: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/profile-checks')) checks.push(request.postDataJSON())
    if (/\/api\/v1\/(orders|access|activations)/.test(request.url())) forbidden.push(request.url())
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })
  return { checks, forbidden, urls }
}

function block(page: Page, step: string) {
  return page.locator(`.review__item[data-step="${step}"]`)
}

const status = (page: Page) => page.getByRole('status')
const proceed = (page: Page) => page.getByRole('button', { name: 'Продолжить' })

test('E2E-03: review shows the checked profile; «Изменить» → save comes back with every answer kept', async ({ page }) => {
  const seen = watchRequests(page)
  await seedDraft(page, complete)
  await page.goto('/create?step=time')
  await page.getByRole('button', { name: 'Проверить данные' }).click()

  await expect(page).toHaveURL('/create/review')
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await expect(block(page, 'name')).toContainText('Анна')
  await expect(block(page, 'date')).toContainText('12 марта 1990')
  await expect(block(page, 'date')).toContainText('понедельник')
  await expect(block(page, 'place')).toContainText('Казань')
  await expect(block(page, 'place')).toContainText('Республика Татарстан · Россия')
  await expect(block(page, 'time')).toContainText('14:30')
  await expect(block(page, 'time')).toContainText('По документу, до минуты')
  await expect(status(page)).toHaveText('Данные проверены.')
  await expect(proceed(page)).not.toHaveAttribute('aria-disabled')
  expect(seen.checks).toEqual([
    { name: 'Анна', birth_date: '1990-03-12', place_id: 'ru-kzn', time: { kind: 'known', value: '14:30', source: 'document', accuracy_minutes: 0 } },
  ])

  await page.getByRole('button', { name: 'Изменить место рождения' }).click()
  await expect(page).toHaveURL('/create?step=place&from=review')
  const city = page.getByRole('combobox', { name: 'Город рождения' })
  await expect(city).toHaveValue(/Казань/)
  await city.fill('Новоси')
  await page.getByRole('option', { name: /Новосибирск/ }).first().click()
  await page.getByRole('button', { name: 'Проверить данные' }).click()

  await expect(page).toHaveURL('/create/review')
  await expect(block(page, 'place')).toContainText('Новосибирск')
  await expect(block(page, 'place')).toContainText('Новосибирская область · Россия')
  await expect(block(page, 'name')).toContainText('Анна')
  await expect(block(page, 'date')).toContainText('12 марта 1990')
  await expect(block(page, 'time')).toContainText('14:30')
  await expect(status(page)).toHaveText('Данные проверены.')
  // Р5: every entry is checked again, and only once.
  expect(seen.checks).toHaveLength(2)
  expect(seen.checks[1]).toMatchObject({ place_id: 'ru-nsk' })

  // «Назад» inside edit mode also returns straight to review.
  await page.getByRole('button', { name: 'Изменить имя' }).click()
  await expect(page).toHaveURL('/create?step=name&from=review')
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Анна')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL('/create/review')

  await proceed(page).click()
  await expect(page).toHaveURL('/create/access')
  expect(seen.forbidden).toEqual([])
  for (const url of seen.urls) expect(decodeURIComponent(url)).not.toMatch(/Анна|1990|Новосибирск|Казань|14:30/)
  await expect.poll(() => storedDraft(page)).toMatchObject({ name: 'Анна', place: { selected: { id: 'ru-nsk' } }, time: { hhmm: '14:30' } })
})

test('without edit mode the steps keep their order and labels', async ({ page }) => {
  await seedDraft(page, { ...complete, step: 'name' })
  await page.goto('/create?step=name')
  await expect(page.getByRole('button', { name: 'Далее' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL('/create?step=date')
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL('/create?step=place')
})

test('unknown time does not promise houses and the ascendant', async ({ page }) => {
  const seen = watchRequests(page)
  await seedDraft(page, { ...complete, time: { kind: 'unknown', hhmm: '', source: 'unknown', accuracy: 0, accuracyTouched: false } })
  await page.goto('/create/review')
  await expect(block(page, 'time')).toContainText('Неизвестно')
  await expect(block(page, 'time')).toContainText('Карта будет построена без домов и асцендента.')
  await expect(status(page)).toHaveText('Данные проверены.')
  expect(seen.checks[0]).toMatchObject({ time: { kind: 'unknown' } })
})

test('MOT-02: «Назад» and the browser buttons between review and the steps keep every answer', async ({ page }) => {
  await seedDraft(page, complete)
  await page.goto('/create?step=time')
  await page.getByRole('button', { name: 'Проверить данные' }).click()
  await expect(page).toHaveURL('/create/review')

  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL('/create?step=time')
  await expect(page.getByLabel('Время по часам')).toHaveValue('14:30')

  await page.goForward()
  await expect(page).toHaveURL('/create/review')
  await expect(block(page, 'time')).toContainText('14:30')
  await page.goBack()
  await expect(page).toHaveURL('/create?step=time')
  await expect(page.getByRole('radio', { name: 'По документу' })).toBeChecked()
})

test('an incomplete draft never reaches review', async ({ page }) => {
  await seedDraft(page, { ...complete, place: { query: 'Каз', selected: null } })
  await page.goto('/create/review')
  await expect(page).toHaveURL('/create?step=place&from=review')
})

test('MOT-03: a field error from the server keeps the answers and blocks «Продолжить»', async ({ page }) => {
  const seen = watchRequests(page)
  await seedDraft(page, complete)
  await page.goto('/create/review?profile-check=nonexistent')
  const time = block(page, 'time')
  await expect(time.locator('.review__note--error')).toBeVisible()
  await expect(time).toContainText('14:30')
  await expect(status(page)).toContainText('Нужно поправить: время рождения.')
  await expect(proceed(page)).toHaveAttribute('aria-disabled', 'true')

  // aria-disabled keeps the button focusable, so it is pressed from the keyboard.
  await proceed(page).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/create\/review/)
  await expect(page.locator('.review__status')).toBeFocused()
  await page.locator('.review__fix', { hasText: 'время рождения' }).click()
  await expect(page).toHaveURL(/step=time.*from=review|from=review.*step=time/)
  await expect(page.getByLabel('Время по часам')).toHaveValue('14:30')
  expect(seen.checks).toHaveLength(1)
})

test('a failed check offers a retry and never retries by itself', async ({ page }) => {
  const seen = watchRequests(page)
  await seedDraft(page, complete)
  await page.goto('/create/review?profile-check=error')
  await expect(status(page)).toHaveText('Не удалось проверить данные. Проверь соединение и попробуй ещё раз.')
  await expect(proceed(page)).toHaveAttribute('aria-disabled', 'true')
  const retry = page.getByRole('button', { name: 'Проверить ещё раз' })
  await page.waitForTimeout(600)
  expect(seen.checks).toHaveLength(1)

  await retry.click()
  await expect(retry).toBeFocused()
  await expect(status(page)).toHaveText(/Не удалось проверить данные/)
  expect(seen.checks).toHaveLength(2)
})

test('a slow check says «Сверяем данные…» without moving the answers', async ({ page }) => {
  const seen = watchRequests(page)
  await seedDraft(page, complete)
  await page.goto('/create/review?profile-check=slow&scene=freeze')
  await expect(status(page)).toHaveText('Сверяем данные…')
  // Measure after the column has risen in; the infinite pulse is the only animation left.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.effect?.getTiming().iterations === Infinity))
  const tops = () => page.locator('.review__item, .review__next').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
  const before = await tops()
  expect(before).toHaveLength(5)
  await expect(status(page)).toHaveText('Данные проверены.', { timeout: 5000 })
  expect(await tops()).toEqual(before)
  expect(seen.checks).toHaveLength(1)
})

for (const [state, query, text] of [
  ['ready', '', 'Данные проверены.'],
  ['field error', 'profile-check=nonexistent', 'Нужно поправить'],
  ['failure', 'profile-check=error', 'Не удалось проверить данные'],
] as const) {
  test(`review (${state}) has no serious accessibility violations`, async ({ page }) => {
    await seedDraft(page, complete)
    await page.goto(`/create/review?scene=freeze${query ? `&${query}` : ''}`)
    await expect(page.locator('main#main')).toHaveCSS('opacity', '1')
    await expect(status(page)).toContainText(text)
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'))
    const results = await new AxeBuilder({ page }).exclude('[data-testid="dev-panel"]').analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('MOT-10: review enters with a short fade, no camera flight and no stagger', async ({ page }) => {
    await seedDraft(page, complete)
    await page.goto('/create?step=time')
    const scene = page.locator('.cosmos-scene')
    await page.getByRole('button', { name: 'Проверить данные' }).click()
    await expect(page).toHaveURL('/create/review')
    await expect(scene).toHaveAttribute('data-scene-composition', 'review')
    expect(await scene.getAttribute('data-scene-moving')).toBe('false')
    await expect(page.locator('.intake__step')).toHaveCount(0)
    await expect(page.locator('.review__value')).toHaveCount(4)
    const names = await page.locator('.review__column, .review__value').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
    expect(names[0]).toMatch(/^review-fade/)
    expect(new Set(names.slice(1))).toEqual(new Set(['none']))
    await expect(status(page)).toHaveText('Данные проверены.')
  })
})

test('without WebGL review works on the poster', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      return String(args[0]).startsWith('webgl') ? null : getContext.apply(this, args)
    } as typeof getContext
  })
  await seedDraft(page, complete)
  await page.goto('/create?step=time')
  const scene = page.locator('.cosmos-scene')
  await expect(scene).toHaveAttribute('data-scene-state', /^(poster|fallback)$/)
  await page.getByRole('button', { name: 'Проверить данные' }).click()
  await expect(page).toHaveURL('/create/review')
  await expect(scene).toHaveAttribute('data-scene-composition', 'review')
  await expect(scene).toHaveAttribute('data-scene-state', /^(poster|fallback)$/)
  await expect(scene.locator('.scene-poster img')).toBeVisible()
  await expect(status(page)).toHaveText('Данные проверены.')
  await proceed(page).click()
  await expect(page).toHaveURL('/create/access')
})

for (const [width, height] of [
  [390, 844],
  [375, 667],
] as const) {
  test(`phone ${String(width)}×${String(height)}: no horizontal scroll, heading focused, «Продолжить» reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await seedDraft(page, complete)
    await page.goto('/create/review?scene=freeze')
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBe(0)
    await proceed(page).scrollIntoViewIfNeeded()
    await expect(proceed(page)).toBeInViewport()
  })
}
