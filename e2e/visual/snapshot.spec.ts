import { expect, test } from '@playwright/test'

import { viewports } from './viewports'

// Deterministic snapshots for the visual stand. They are not asserted here:
// visual/compare.mjs builds side-by-side, overlay and diff images from them.
for (const vp of viewports) {
  test(`home snapshot ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/?scene=freeze')
    await expect(page.locator('.cosmos-scene')).toHaveAttribute('data-scene-state', /^(webgl|poster|fallback)$/)
    await expect(page.getByTestId('dev-panel')).toHaveCount(0)
    await expect(page.locator('main#main')).toHaveCSS('opacity', '1')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: `visual/output/snapshots/${vp.name}.png`,
      animations: 'disabled',
      caret: 'hide',
    })
  })
}
