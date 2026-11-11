import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// SCR-01 (slice V1.1): copy of hero-approved.png, navigation-only actions,
// the pause control and the poster fallback.

test('first screen carries the approved copy', async ({ page }) => {
  await page.goto('/')
  const main = page.locator('main#main')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/У каждого —\s*свой космос\./)
  await expect(main.getByText('Искусство узнавать себя')).toBeVisible()
  await expect(main.getByText('В момент твоего рождения звёзды сложились')).toBeVisible()
  await expect(main.getByText('в неповторимую историю. Познакомься со своей.')).toBeVisible()
  await expect(main.getByText('Твоя дата. Твоё место. Твоя вселенная.')).toBeVisible()
  await expect(main.getByText('Ближе к себе. Дальше привычного.')).toBeVisible()
  await expect(main.getByText('Натальная карта · Личный разбор · Новый взгляд')).toBeVisible()
})

test('primary action opens the intake without calling the order API', async ({ page }) => {
  const orderCalls: string[] = []
  page.on('request', (request) => {
    if (/\/api\/v1\/orders/.test(request.url())) orderCalls.push(request.url())
  })
  await page.goto('/')

  await page.getByRole('link', { name: 'Построить мою карту' }).click()
  await expect(page).toHaveURL('/create')
  await expect(page.getByRole('heading', { level: 1, name: 'Анкета рождения' })).toBeFocused()
  expect(orderCalls).toEqual([])
})

test('secondary action opens the example', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Смотреть пример' }).click()
  await expect(page).toHaveURL('/example')
})

test('sign-in and activation are reachable from the first screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Войти' }).click()
  await expect(page).toHaveURL('/login')

  await page.goto('/')
  await page.getByRole('link', { name: 'Есть код активации' }).click()
  await expect(page).toHaveURL('/activate')
})

test('the pause control stops ambient scene motion', async ({ page }) => {
  await page.goto('/')
  const toggle = page.getByRole('button', { name: /Замедлись\. Почувствуй\./ })
  const scene = page.locator('.cosmos-scene')

  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(scene).toHaveAttribute('data-scene-motion', 'paused')
  await toggle.press('Enter')
  await expect(scene).toHaveAttribute('data-scene-motion', 'running')
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('ambient motion starts paused and the control says so', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Замедлись\. Почувствуй\./ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.cosmos-scene')).toHaveAttribute('data-scene-motion', 'paused')
  })

  test('scroll parallax is off on phones', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('.hero__ground .scene-ground')).toBeVisible()
    const scrollDriven = await page.evaluate(
      () => document.getAnimations().filter((a) => !(a.timeline instanceof DocumentTimeline)).length,
    )
    expect(scrollDriven).toBe(0)
  })
})

test('phones get scroll parallax while ambient motion runs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.hero__ground .scene-ground')).toBeVisible()
  const scrollDriven = await page.evaluate(
    () => document.getAnimations().filter((a) => !(a.timeline instanceof DocumentTimeline)).length,
  )
  expect(scrollDriven).toBeGreaterThan(0)
})

// Owner decision, variant B: a portrait composition of its own, not the desktop scaled down.
for (const [width, height] of [
  [390, 844],
  [375, 812],
  [375, 667],
  [390, 664],
] as const) {
  test(`portrait composition at ${String(width)}×${String(height)}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/?scene=freeze')
    const main = page.locator('main#main')

    const cta = await page.getByRole('link', { name: 'Построить мою карту' }).boundingBox()
    expect(cta && cta.y + cta.height).toBeLessThanOrEqual(height)
    await expect(page.locator('.cosmos-scene')).toHaveAttribute('data-scene-ground', 'page')

    const band = main.locator('.scene-ground img')
    await band.scrollIntoViewIfNeeded()
    await expect(band).toBeVisible()
    await expect.poll(() => band.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    await expect(main.getByText('Бесконечность')).toBeVisible()
    await expect(main.getByText('начинается внутри')).toBeVisible()
    await expect(main.locator('.hero__count')).toBeVisible()
    await expect(page.getByRole('button', { name: /Замедлись\. Почувствуй\./ })).toBeInViewport()
  })
}

for (const width of [320, 375, 390, 768, 1024, 1440]) {
  test(`no horizontal scroll at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBe(0)
  })
}

test('the static tier shows the full poster without WebGL', async ({ page }) => {
  await page.goto('/?tier=static')
  const scene = page.locator('.cosmos-scene')

  await expect(scene).toHaveAttribute('data-scene-state', 'poster')
  await expect(scene.locator('.scene-poster img')).toBeVisible()
  await expect(scene.locator('.scene-poster svg path')).not.toHaveCount(0)
  await expect(scene.locator('canvas')).not.toHaveClass(/is-active/)
})

test('keyboard order follows the reading order of the first screen', async ({ page }) => {
  await page.goto('/?scene=freeze')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  const names: string[] = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    names.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''))
  }
  expect(names[0]).toBe('Перейти к содержанию')
  expect(names[1]).toBe('Построить мою карту')
  expect(names[2]).toBe('Смотреть пример')
  expect(names[3]).toBe('Войти')
  expect(names[4]).toBe('Есть код активации')
  expect(names[5]).toMatch(/^Замедлись\. Почувствуй\./)
})

for (const [width, height] of [
  [1280, 720],
  [390, 844],
] as const) {
  test(`home has no serious accessibility violations at ${String(width)}×${String(height)}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/?scene=freeze')
    await expect(page.locator('main#main')).toHaveCSS('opacity', '1')
    // Contrast is only meaningful once the entrance (M01) has settled; scroll-driven animations never finish.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => !(a.timeline instanceof DocumentTimeline) || a.playState === 'finished'),
    )
    const results = await new AxeBuilder({ page }).exclude('[data-testid="dev-panel"]').analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}
