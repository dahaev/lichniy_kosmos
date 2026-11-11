import { expect, test, type Page } from '@playwright/test'

const homeHeading = /^У каждого —\s*свой космос\.$/

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test('home opens with MSW mocks as the data source', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/')

  await expect(page).toHaveTitle('Главная — Личный космос')
  await expect(page.getByRole('heading', { level: 1, name: homeHeading })).toBeVisible()
  await expect(page.getByTestId('api-source')).toHaveText('MSW-моки')
  expect(errors).toEqual([])
})

test('API requests are served by the mock worker', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('api-source')).toHaveText('MSW-моки')

  const res = await page.evaluate(async () => {
    const r = await fetch('/api/v1/config')
    return { status: r.status, mock: r.headers.get('x-cosmos-mock'), body: (await r.json()) as unknown }
  })
  expect(res).toEqual({
    status: 200,
    mock: '1',
    body: { environment: 'local', features: { code_login: false, email_login: false, generation: false } },
  })
})

for (const [path, title] of [
  ['/orders/demo', 'Ваш разбор'],
  ['/legal/terms', 'Условия использования'],
] as const) {
  test(`route ${path} renders its placeholder`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page).toHaveTitle(`${title} — Личный космос`)
  })
}

test('unknown path shows the not-found screen', async ({ page }) => {
  await page.goto('/no/such/page')
  await expect(page.getByRole('heading', { level: 1, name: 'Страница не найдена' })).toBeVisible()
  await page.getByRole('link', { name: 'На главную' }).click()
  await expect(page).toHaveURL('/')
})

test('client navigation moves focus to the heading and announces the page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('api-source')).toHaveText('MSW-моки')

  await page.getByTestId('dev-panel').locator('summary').click()
  await page.getByRole('link', { name: 'SCR-08 /login', exact: true }).click()

  const heading = page.getByRole('heading', { level: 1, name: 'Вход по почте' })
  await expect(heading).toBeFocused()
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Вход по почте')
})

test('skip link is the first focusable element and targets main', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Перейти к содержанию' })
  await expect(skip).toBeFocused()
  await expect(skip).toHaveAttribute('href', '#main')
  await expect(page.locator('main#main')).toHaveCount(1)
})

test('scene shell settles and follows the route composition', async ({ page }) => {
  await page.goto('/')
  const scene = page.locator('.cosmos-scene')

  await expect(scene).toHaveAttribute('data-scene-state', /^(webgl|poster|fallback)$/)
  await expect(scene).toHaveAttribute('data-scene-composition', 'hero')
  await expect(scene).toHaveAttribute('aria-hidden', 'true')

  await page.getByTestId('dev-panel').locator('summary').click()
  await page.getByRole('link', { name: 'SCR-02 /create', exact: true }).click()
  await expect(scene).toHaveAttribute('data-scene-composition', 'intake.name')
  expect(await page.locator('canvas').count()).toBe(1)
})

test('the intake opens without console errors and carries its title', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.goto('/create')
  await expect(page).toHaveTitle('Анкета рождения — Личный космос')
  await expect(page.getByRole('heading', { level: 1, name: 'Как тебя зовут?' })).toBeVisible()
  expect(errors).toEqual([])
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('motion tokens collapse', async ({ page }) => {
    await page.goto('/')
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement)
      return {
        route: s.getPropertyValue('--cosmos-dur-route').trim(),
        camera: s.getPropertyValue('--cosmos-dur-camera').trim(),
        reveal: s.getPropertyValue('--cosmos-dur-reveal').trim(),
      }
    })
    expect(tokens).toEqual({ route: '200ms', camera: '0ms', reveal: '0ms' })
    await expect(page.getByRole('heading', { level: 1, name: homeHeading })).toBeVisible()
  })
})
