import { expect, test, type Page } from '@playwright/test'

import { viewports } from './viewports'

// Deterministic snapshots of the four intake steps (SCR-02) and of the
// hero → step 01 flight, for owner review. Not asserted: the owner approves
// frames by images (SCR-02 §0.3).

const steps = ['name', 'date', 'place', 'time'] as const

/** Synthetic answers only; nothing here is a real person's data. */
const draft = {
  version: 1,
  updatedAt: Date.now(),
  step: 'time',
  name: 'Анна',
  date: { day: '12', month: '03', year: '1990' },
  place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' } },
  time: { kind: 'known', hhmm: '14:30', source: 'document', accuracy: 0, accuracyTouched: false },
}

async function seedDraft(page: Page) {
  await page.addInitScript((value) => {
    sessionStorage.setItem('cosmos.intake.v1', JSON.stringify({ ...value, updatedAt: Date.now() }))
  }, draft)
}

async function settle(page: Page) {
  await expect(page.locator('.cosmos-scene')).toHaveAttribute('data-scene-state', /^(webgl|poster|fallback)$/)
  await expect(page.locator('main#main')).toHaveCSS('opacity', '1')
  await page.evaluate(() => document.fonts.ready)
}

const reviewViewports = viewports.filter((vp) => ['desktop-1440', 'mobile-390', 'tablet-768', 'wide-1920', 'mobile-375-short'].includes(vp.name))

for (const vp of reviewViewports) {
  for (const step of steps) {
    test(`intake ${step} ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await seedDraft(page)
      await page.goto(`/create?step=${step}&scene=freeze`)
      await settle(page)
      await expect(page.locator('.cosmos-scene')).toHaveAttribute('data-scene-composition', `intake.${step}`)
      await page.screenshot({ path: `visual/output/intake/${vp.name}-${step}.png`, animations: 'disabled', caret: 'hide' })
    })
  }
}

// Ж9: what stays visible above an ≈336px keyboard once the focused field has
// been brought into view (the stricter resizes-content model).
for (const vp of viewports.filter((v) => ['mobile-390', 'mobile-375-short'].includes(v.name))) {
  for (const { step, label } of [
    { step: 'time', label: 'Время по часам' },
    { step: 'place', label: 'Город рождения' },
  ] as const) {
    test(`keyboard open ${step} ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.addInitScript((value) => sessionStorage.setItem('cosmos.intake.v1', JSON.stringify({ ...value, updatedAt: Date.now() })), {
        ...draft,
        ...(step === 'place' ? { place: { query: '', selected: null } } : {}),
      })
      await page.goto(`/create?step=${step}&scene=freeze`)
      await settle(page)
      const field = page.getByLabel(label, { exact: true })
      await field.focus()
      await page.setViewportSize({ width: vp.width, height: vp.height - 336 })
      await field.evaluate((el) => el.scrollIntoView({ block: 'nearest' }))
      if (step === 'place') {
        await field.pressSequentially('Каз')
        await page.getByRole('option').first().waitFor()
      }
      await page.screenshot({ path: `visual/output/keyboard/${vp.name}-${step}.png`, animations: 'disabled', caret: 'hide' })
    })
  }
}

for (const vp of viewports.filter((v) => ['desktop-1440', 'mobile-390'].includes(v.name))) {
  test(`hero → name flight ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/?scene=freeze')
    await settle(page)
    for (const progress of [0, 0.35, 0.7, 1]) {
      await page.evaluate((p) => {
        ;(window as unknown as { __cosmosScene: { preview: (a: string, b: string, p: number) => void } }).__cosmosScene.preview('hero', 'intake.name', p)
      }, progress)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.screenshot({
        path: `visual/output/flight/${vp.name}-${String(Math.round(progress * 100)).padStart(3, '0')}.png`,
        animations: 'disabled',
        caret: 'hide',
        // Only the scene: the hero copy would hide the frame being judged.
        style: 'main#main { visibility: hidden !important; }',
      })
    }
  })

  // Ж11: the way back is live, copy and camera together. Frames are taken as
  // fast as the browser allows and kept by their real time after the click.
  test(`intake → hero return ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/')
    await page.getByRole('link', { name: 'Построить мою карту' }).click()
    await expect(page.locator('.cosmos-scene')).toHaveAttribute('data-scene-moving', 'false', { timeout: 5000 })
    await page.getByRole('link', { name: 'На главную' }).click()
    const start = Date.now()
    const marks = [0, 250, 600, 1600]
    for (const mark of marks) {
      const wait = start + mark - Date.now()
      if (wait > 0) await page.waitForTimeout(wait)
      await page.screenshot({ path: `visual/output/return/${vp.name}-${String(marks.indexOf(mark))}.png`, caret: 'hide' })
    }
  })
}
