import { expect, test, type Page, type Route } from '@playwright/test'

// SCR-05, decisions Р-C10 and Р-C12: in the production bundle order creation
// cannot be opened from the client. The server below is as generous as it can
// be (`legal_ready=true`, generation on, a code session with a free access,
// even the mock stand's own header), and the page still never sends
// `POST /api/v1/orders` and shows no test mode. Synthetic data only.

const DRAFT_KEY = 'cosmos.intake.v1'
const ENTITLEMENT = '00000000-0000-4000-8000-00000000f001'

const complete = {
  version: 1,
  step: 'time',
  name: 'Анна',
  date: { day: '12', month: '03', year: '1990' },
  place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
  time: { kind: 'known', hhmm: '14:30', source: 'document', accuracy: 0, accuracyTouched: false },
}

const kazan = { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия', latitude: 55.79, longitude: 49.12, timezone: 'Europe/Moscow' }

function json(route: Route, body: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

/** A server that would let the order through, and a count of what the page actually asked for. */
async function openServer(page: Page, { claimToBeMock }: { claimToBeMock: boolean }) {
  const orders: unknown[] = []
  const headers: Record<string, string> = claimToBeMock ? { 'x-cosmos-mock': '1' } : {}
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/v1/config') {
      return json(route, { environment: 'production', features: { code_login: true, email_login: false, generation: true }, consent_version: 'v1', legal_ready: true }, headers)
    }
    if (pathname === '/api/v1/session') {
      return json(route, {
        principal: 'code',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        entitlement: { id: ENTITLEMENT, code_mask: '7K2Q', state: 'available' },
      })
    }
    if (pathname === '/api/v1/profile-checks') {
      return json(route, { profile: route.request().postDataJSON(), place: kazan })
    }
    if (pathname === '/api/v1/orders') {
      orders.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-4000-8000-0000000e0001', status: 'queued' }) })
    }
    return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' }) })
  })
  return orders
}

async function reach(page: Page, query: string) {
  await page.addInitScript(
    ([key, draft]) => {
      if (sessionStorage.getItem('e2e.seeded')) return
      sessionStorage.setItem('e2e.seeded', '1')
      sessionStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() }))
    },
    [DRAFT_KEY, complete] as const,
  )
  await page.goto('/create/review')
  await expect(page.getByRole('status')).toHaveText('Данные проверены.')
  await page.goto(`/create/consent${query}`)
  await expect(page).toHaveURL(/\/create\/consent/)
}

for (const claimToBeMock of [false, true]) {
  const server = claimToBeMock ? 'an open server that also sends the mock header' : 'an open server'

  test(`production bundle with ${server}: creation stays blocked, whatever the URL says`, async ({ page }) => {
    const orders = await openServer(page, { claimToBeMock })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    for (const query of ['', '?creation=test', '?creation=test&orders=slow&legal_ready=true&mode=test&test=1']) {
      await reach(page, query)
      await expect(page.getByText('Создание разбора пока недоступно.')).toBeVisible()
      await expect(page.getByRole('checkbox')).toHaveCount(0)
      await expect(page.locator('[data-test-mode]')).toHaveCount(0)
      await expect(page.getByText(/Тестовый режим|Текст согласия появится/)).toHaveCount(0)

      const button = page.getByRole('button', { name: 'Создать мой разбор' })
      await expect(button).toHaveAttribute('aria-disabled', 'true')
      await button.click({ force: true })
      await button.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Space')
      await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    }

    await page.waitForTimeout(500)
    expect(orders).toEqual([])
    expect(errors).toEqual([])
  })
}

test('production bundle: the stand switches do nothing in sessionStorage or the global scope either', async ({ page }) => {
  const orders = await openServer(page, { claimToBeMock: true })
  await reach(page, '?creation=test')
  await expect(page.getByText('Создание разбора пока недоступно.')).toBeVisible()

  // Whatever a visitor plants in the page, there is no path from it to the request.
  await page.evaluate(() => {
    sessionStorage.setItem('cosmos.creation', 'test')
    localStorage.setItem('cosmos.creation', 'test')
    Object.assign(window, { __COSMOS_CREATION__: 'test', __TEST_MODE__: true })
  })
  await page.reload()
  await expect(page.getByText('Создание разбора пока недоступно.')).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  expect(orders).toEqual([])
})
