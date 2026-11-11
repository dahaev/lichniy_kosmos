import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// SCR-02 (slice V1.2): the four-step birth intake on MSW mocks. Every
// answer below is synthetic.

const DRAFT_KEY = 'cosmos.intake.v1'
const steps = ['name', 'date', 'place', 'time'] as const

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
  const orders: string[] = []
  const urls: string[] = []
  page.on('request', (request) => {
    if (/\/api\/v1\/orders/.test(request.url())) orders.push(request.url())
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })
  return { orders, urls }
}

test('E2E-01: the whole intake from the keyboard, without orders and without answers in the URL', async ({ page }) => {
  const seen = watchRequests(page)
  await page.goto('/?scene=freeze')
  await page.getByRole('link', { name: 'Построить мою карту' }).click()

  await expect(page).toHaveURL('/create?step=name')
  await expect(page.getByLabel('Имя')).toBeFocused()
  await page.keyboard.type('Анна')
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL('/create?step=date')
  await expect(page.getByLabel('День')).toBeFocused()
  await page.keyboard.type('12031990')
  await expect(page.getByLabel('Год')).toHaveValue('1990')
  await expect(page.getByText('12 марта 1990, понедельник')).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL('/create?step=place')
  const city = page.getByRole('combobox', { name: 'Город рождения' })
  await expect(city).toBeFocused()
  await page.keyboard.type('Каз')
  await expect(page.getByRole('option', { name: /Казань/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(city).toHaveValue(/Казань/)
  await expect(page).toHaveURL('/create?step=place')
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL('/create?step=time')
  const known = page.getByRole('radio', { name: 'Знаю время' })
  await expect(known).toBeFocused()
  await page.keyboard.press('Space')
  await expect(known).toBeChecked()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Время по часам')).toBeFocused()
  await page.keyboard.type('1430')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Время по часам')).toHaveValue('14:30')
  await page.keyboard.press('Space')
  await expect(page.getByRole('radio', { name: 'По документу' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'До минуты' })).toBeChecked()
  await page.getByRole('button', { name: 'Проверить данные' }).focus()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL('/create/review')
  expect(seen.orders).toEqual([])
  for (const url of seen.urls) expect(decodeURIComponent(url)).not.toMatch(/Анна|1990|Казань|14:30/)
  await expect.poll(() => storedDraft(page)).toMatchObject({ name: 'Анна', date: { day: '12', month: '03', year: '1990' }, time: { kind: 'known', hhmm: '14:30' } })
})

test('E2E-02: unknown time records source unknown and explains what is lost', async ({ page }) => {
  await seedDraft(page, { ...complete, time: { kind: null, hhmm: '', source: null, accuracy: null, accuracyTouched: false } })
  await page.goto('/create?step=time')
  await page.getByRole('radio', { name: 'Не знаю' }).check()
  await expect(page.getByText(/не будем строить дома и асцендент/)).toBeVisible()
  const known = page.locator('.time-step__known')
  await expect(known).toHaveAttribute('inert', '')
  await expect.poll(async () => (await known.boundingBox())?.height).toBeLessThan(1)
  await page.getByRole('button', { name: 'Проверить данные' }).click()
  await expect(page).toHaveURL('/create/review')
  await expect.poll(async () => (await storedDraft(page))?.time).toMatchObject({ kind: 'unknown', hhmm: '', source: 'unknown', accuracy: 0 })
})

test('input errors are shown on the field and keep the visitor on the step', async ({ page }) => {
  await page.goto('/create?step=name')
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL('/create?step=name')
  await expect(page.getByLabel('Имя')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Имя')).toBeFocused()

  await page.getByLabel('Имя').fill('Анна')
  await page.keyboard.press('Enter')
  await page.getByLabel('День').fill('31')
  await page.getByLabel('Месяц').fill('02')
  await page.getByLabel('Год').fill('2001')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/create?step=date')
  await expect(page.getByText('Такой даты нет: в феврале 2001 года 28 дней.')).toBeVisible()

  await page.getByLabel('День').fill('28')
  await page.getByLabel('Год').fill('2999')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Дата не может быть позже сегодняшней.')).toBeVisible()

  await page.getByLabel('Год').fill('2001')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/create?step=place')
  await page.getByRole('combobox', { name: 'Город рождения' }).fill('Казань')
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL('/create?step=place')
  await expect(page.getByText('Выбери город из списка — так мы точно определим координаты.')).toBeVisible()
})

test('after a step change a failed «Далее» still moves focus to the field, and leaving blocks are inert', async ({ page }) => {
  await seedDraft(page, { ...complete, step: 'name', date: { day: '', month: '', year: '' } })
  await page.goto('/create?step=name')
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL('/create?step=date')
  // Let the name block finish leaving and unmount.
  await expect(page.locator('.intake__step')).toHaveCount(1)
  await page.getByRole('button', { name: 'Назад' }).focus()
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByLabel('День')).toBeFocused()
  await expect(page.getByText('Укажи день, месяц и год.')).toBeVisible()

  await page.getByLabel('День').fill('12')
  await page.getByLabel('Месяц').fill('03')
  await page.getByLabel('Год').fill('1990')
  await page.getByRole('button', { name: 'Далее' }).click()
  // The date block leaves for 200 ms; during that it must not take input.
  const leaving = await page.evaluate(() => [...document.querySelectorAll('.intake__step')].map((el) => el.hasAttribute('inert')))
  expect(leaving).toContain(true)
})

test('MOT-02: «Назад» and the browser buttons keep every answer', async ({ page }) => {
  await seedDraft(page, { ...complete, step: 'place' })
  await page.goto('/create?step=name')
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL('/create?step=date')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/create?step=place')

  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL('/create?step=date')
  await expect(page.getByLabel('День')).toHaveValue('12')

  await page.goBack()
  await expect(page).toHaveURL('/create?step=name')
  await expect(page.getByLabel('Имя')).toHaveValue('Анна')

  await page.goForward()
  await expect(page).toHaveURL('/create?step=date')
  await expect(page.getByLabel('Год')).toHaveValue('1990')

  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL('/')
})

test('a reload keeps the step and the answers; a skipped step is not reachable', async ({ page }) => {
  await page.goto('/create?step=name')
  await page.getByLabel('Имя').fill('Анна')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/create?step=date')
  await page.getByLabel('День').fill('12')
  await expect.poll(async () => (await storedDraft(page))?.date).toMatchObject({ day: '12' })

  await page.reload()
  await expect(page).toHaveURL('/create?step=date')
  await expect(page.getByLabel('День')).toHaveValue('12')

  await page.goto('/create?step=time')
  await expect(page).toHaveURL('/create?step=date')
  await page.goto('/create')
  await expect(page).toHaveURL('/create?step=date')
})

test('a damaged draft is dropped and the intake starts over', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('e2e.seeded')) {
      sessionStorage.setItem('e2e.seeded', '1')
      sessionStorage.setItem(key, '{"version":1,"name":')
    }
  }, DRAFT_KEY)
  await page.goto('/create?step=date')
  await expect(page).toHaveURL('/create?step=name')
  await expect(page.getByLabel('Имя')).toHaveValue('')
})

test.describe('city search states', () => {
  test.beforeEach(async ({ page }) => {
    await seedDraft(page, { ...complete, step: 'place', place: { query: '', selected: null } })
  })

  test('nothing found', async ({ page }) => {
    await page.goto('/create?step=place&places=empty')
    await page.getByRole('combobox', { name: 'Город рождения' }).fill('Каз')
    await expect(page.getByText(/Ничего не нашли/).first()).toBeVisible()
  })

  test('search failure offers a retry', async ({ page }) => {
    await page.goto('/create?step=place&places=error')
    await page.getByRole('combobox', { name: 'Город рождения' }).fill('Каз')
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
  })

  test('a slow answer says «Ищем…» and typing is never blocked', async ({ page }) => {
    await page.goto('/create?step=place&places=slow')
    const city = page.getByRole('combobox', { name: 'Город рождения' })
    await city.pressSequentially('Каз')
    await expect(page.locator('.city__note', { hasText: 'Ищем…' })).toBeVisible()
    await city.pressSequentially('ань')
    await expect(city).toHaveValue('Казань')
    await expect(page.getByRole('option', { name: /Казань/ }).first()).toBeVisible({ timeout: 5000 })
  })
})

test('MOT-03: the camera flies between steps and input works during the flight', async ({ page }) => {
  await seedDraft(page, { ...complete, step: 'name' })
  await page.goto('/create?step=name')
  const scene = page.locator('.cosmos-scene')
  await expect(scene).toHaveAttribute('data-scene-composition', 'intake.name')
  await expect(scene).toHaveAttribute('data-scene-state', 'webgl')

  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(scene).toHaveAttribute('data-scene-composition', 'intake.date')
  await expect(scene).toHaveAttribute('data-scene-moving', 'true')
  // Typing during the flight lands in the field at once.
  await page.getByLabel('День').fill('')
  await page.keyboard.type('1')
  await expect(page.getByLabel('День')).toHaveValue('1')
  await expect(scene).toHaveAttribute('data-scene-moving', 'false', { timeout: 4000 })
})

test('rapid forward and back: one canvas, a continuous camera, every answer kept', async ({ page }) => {
  await seedDraft(page, { ...complete, step: 'name' })
  await page.addInitScript(() => {
    const probe = { canvases: 0, contexts: 0, samples: [] as { t: number; x: number; y: number }[] }
    Object.assign(window, { __probe: probe })
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (String(args[0]).startsWith('webgl')) probe.contexts++
      return getContext.apply(this, args)
    } as typeof getContext
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLCanvasElement || (n instanceof Element && n.querySelector('canvas'))) probe.canvases++
    }).observe(document, { childList: true, subtree: true })
    const sample = (t: number) => {
      const plate = document.querySelector('.scene-poster__plate:not(.scene-poster__ghost)')
      if (plate) {
        const m = new DOMMatrixReadOnly(getComputedStyle(plate).transform)
        probe.samples.push({ t, x: m.m41, y: m.m42 })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.goto('/create?step=name')
  const scene = page.locator('.cosmos-scene')
  await expect(scene).toHaveAttribute('data-scene-state', 'webgl')
  await expect(scene).toHaveAttribute('data-scene-moving', 'false', { timeout: 4000 })
  const before = await page.evaluate(() => (window as unknown as { __probe: { canvases: number; contexts: number } }).__probe)

  const next = page.getByRole('button', { name: 'Далее' })
  const back = page.getByRole('button', { name: 'Назад' })
  const beat = () => page.waitForTimeout(140)
  await next.click()
  await beat()
  await next.click()
  await beat()
  await back.click()
  await beat()
  await page.goBack()
  await beat()
  await page.goForward()
  await beat()
  await next.click()
  await beat()
  await next.click()
  await beat()
  await page.goBack()
  await beat()
  await back.click()
  await expect(scene).toHaveAttribute('data-scene-moving', 'false', { timeout: 4000 })
  const landed = new URL(page.url()).searchParams.get('step')
  await expect(scene).toHaveAttribute('data-scene-composition', `intake.${String(landed)}`)

  const probe = await page.evaluate(() => (window as unknown as { __probe: { canvases: number; contexts: number; samples: { t: number; x: number; y: number }[] } }).__probe)
  expect(probe.canvases).toBe(before.canvases)
  expect(probe.contexts).toBe(before.contexts)
  await expect(page.locator('canvas')).toHaveCount(1)

  // A snap shows up as one frame covering a whole flight; a continuous camera
  // never moves faster than its peak cruising speed between two frames.
  let worst = 0
  for (const [i, b] of probe.samples.entries()) {
    const a = probe.samples[i - 1]
    if (!a) continue
    const dt = Math.max(b.t - a.t, 16)
    worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y) / dt)
  }
  expect(worst).toBeLessThan(1.5)

  await expect.poll(async () => await storedDraft(page)).toMatchObject({
    name: complete.name,
    date: complete.date,
    place: { selected: { id: 'ru-kzn' } },
    time: { kind: 'known', hhmm: '14:30' },
  })
})

test('a taller step leaving never covers the buttons', async ({ page }) => {
  await seedDraft(page, complete)
  await page.goto('/create?step=time')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.locator('.intake__step[inert]')).toHaveCount(1)
  // Hit testing skips inert nodes; lifting inert for the probe shows what is painted on top.
  const covered = await page.evaluate(() => {
    const leaving = document.querySelector<HTMLElement>('.intake__step[inert]')!
    leaving.style.zIndex = getComputedStyle(leaving).zIndex
    leaving.removeAttribute('inert')
    const result = ['.intake__next', '.intake__back'].map((selector) => {
      const el = document.querySelector(selector)!
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return top === el || el.contains(top) ? null : top?.closest('.intake__step') ? 'leaving step' : String(top?.className)
    })
    leaving.setAttribute('inert', '')
    return result
  })
  expect(covered).toEqual([null, null])
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('MOT-10: steps change without a camera flight', async ({ page }) => {
    await seedDraft(page, { ...complete, step: 'name' })
    await page.goto('/create?step=name')
    const scene = page.locator('.cosmos-scene')
    await page.getByRole('button', { name: 'Далее' }).click()
    await expect(scene).toHaveAttribute('data-scene-composition', 'intake.date')
    const moving = await scene.getAttribute('data-scene-moving')
    expect(moving).toBe('false')
  })
})

test('MOT-11: the static tier moves the poster through all steps', async ({ page }) => {
  await seedDraft(page, { ...complete, step: 'name' })
  await page.goto('/create?step=name&tier=static')
  const scene = page.locator('.cosmos-scene')
  await expect(scene).toHaveAttribute('data-scene-state', 'poster')
  for (const step of steps.slice(1)) {
    await page.getByRole('button', { name: 'Далее' }).click()
    await expect(page).toHaveURL(new RegExp(`step=${step}`))
    await expect(scene).toHaveAttribute('data-scene-composition', `intake.${step}`)
  }
  await expect(scene.locator('.scene-poster img')).toBeVisible()
})

for (const [width, height] of [
  [390, 844],
  [375, 667],
] as const) {
  test.describe(`phone ${String(width)}×${String(height)}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true })

    for (const step of steps) {
      test(`step ${step}: no horizontal scroll, question up top, field above the keyboard, heading focused`, async ({ page }) => {
        await seedDraft(page, complete)
        await page.goto(`/create?step=${step}&scene=freeze`)
        const heading = page.getByRole('heading', { level: 1 })
        await expect(heading).toBeFocused()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow).toBe(0)
        const box = await heading.boundingBox()
        expect(box && box.y + box.height).toBeLessThanOrEqual(height / 2)
        // iOS keyboard with the suggestion bar: ≈336px. On tall phones the first
        // control and its hint stay above it; short phones scroll the focused field up.
        if (height >= 800) {
          const field = page.locator('.intake__step .field__control, .intake__step .choice__options').first()
          const fieldBox = await field.boundingBox()
          expect(fieldBox && fieldBox.y + fieldBox.height + 40).toBeLessThanOrEqual(height - 336)
        }
      })
    }

    // Ж9: the page declares interactive-widget=resizes-visual, so the keyboard
    // only covers the bottom of the visual viewport. Shrinking the viewport by
    // the keyboard and scrolling the focused field into view, as the browser
    // does, is the stricter model: nothing may cover the field or push the page sideways.
    const typed = [
      { step: 'name', label: 'Имя' },
      { step: 'date', label: 'День' },
      { step: 'date', label: 'Год' },
      { step: 'place', label: 'Город рождения' },
      { step: 'time', label: 'Время по часам' },
    ] as const
    for (const { step, label } of typed) {
      test(`keyboard open on ${step} «${label}»: the field stays visible and uncovered`, async ({ page }) => {
        await seedDraft(page, step === 'place' ? { ...complete, place: { query: '', selected: null } } : complete)
        await page.goto(`/create?step=${step}&scene=freeze`)
        await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
        const field = page.getByLabel(label, { exact: true })
        await field.focus()
        await page.setViewportSize({ width, height: height - 336 })
        await field.evaluate((el) => el.scrollIntoView({ block: 'nearest' }))
        if (step === 'place') await field.pressSequentially('Каз')

        const visible = height - 336
        const box = await field.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.y + box!.height).toBeLessThanOrEqual(visible)
        const hint = page.locator('.field__control:focus-within + .field__message')
        if ((await hint.count()) > 0 && step !== 'place') {
          const hintBox = await hint.boundingBox()
          expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(visible)
        }
        const hit = await field.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return top === el || el.contains(top)
        })
        expect(hit).toBe(true)
        if (step === 'place') {
          const option = page.getByRole('option').first()
          await expect(option).toBeVisible()
          const optionBox = await option.boundingBox()
          expect(optionBox!.y + optionBox!.height).toBeLessThanOrEqual(visible)
          // Nothing later in the step (the actions) is painted over the suggestions.
          const covered = await page.getByRole('option').evaluateAll((options) =>
            options.slice(0, 2).map((el) => {
              const r = el.getBoundingClientRect()
              const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
              return top === el || el.contains(top) ? null : (top?.className ?? 'nothing')
            }),
          )
          expect(covered).toEqual([null, null])
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow).toBe(0)
        await expect(page.locator('canvas')).toHaveCount(1)
      })
    }
  })
}

for (const step of steps) {
  test(`step ${step} has no serious accessibility violations`, async ({ page }) => {
    await seedDraft(page, complete)
    await page.goto(`/create?step=${step}&scene=freeze`)
    await expect(page.locator('main#main')).toHaveCSS('opacity', '1')
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'))
    const results = await new AxeBuilder({ page }).exclude('[data-testid="dev-panel"]').analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}
