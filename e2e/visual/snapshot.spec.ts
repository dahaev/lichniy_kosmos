import { writeFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { viewports } from './viewports'

/** Positions of the hero anchors listed in reference/hero-anchors.json. */
async function readAnchors(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const el = (selector: string) => {
      const found = document.querySelector(selector)
      if (!found) throw new Error(`anchor ${selector} is missing`)
      return found
    }
    const ink = (selector: string) => {
      const range = document.createRange()
      range.selectNodeContents(el(selector))
      return range.getBoundingClientRect()
    }
    const baseline = (selector: string) => {
      const probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
      el(selector).appendChild(probe)
      const y = probe.getBoundingClientRect().y
      probe.remove()
      return y
    }
    const style = document.documentElement.style
    const px = (name: string) => Number.parseFloat(style.getPropertyValue(name))
    const line = ink('.hero__title-line')
    const accent = ink('.hero__title-accent')
    const cta = el('.hero__primary').getBoundingClientRect()
    const strip = el('.hero__strip').getBoundingClientRect()
    const ring = el('.motion-toggle__ring').getBoundingClientRect()
    return {
      headingLeft: line.left,
      headingRight: line.right,
      headingBaseline: baseline('.hero__title-line'),
      accentRight: accent.right,
      accentBaseline: baseline('.hero__title-accent'),
      leadBaseline: baseline('.hero__lead-line'),
      ctaLeft: cta.left,
      ctaTop: cta.top,
      ctaWidth: cta.width,
      ctaHeight: cta.height,
      planetX: px('--planet-x'),
      planetY: px('--planet-y'),
      planetR: px('--planet-r'),
      horizonY: px('--horizon-y'),
      stripLineY: strip.top,
      toggleX: ring.left + ring.width / 2,
      toggleY: ring.top + ring.height / 2,
    }
  })
}

// Deterministic snapshots for the visual stand. They are not asserted here:
// visual/compare.mjs builds side-by-side, overlay and diff images from them
// and checks the anchors of the reference frame.
for (const vp of viewports) {
  test(`home snapshot ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/?scene=freeze')
    await expect(page.locator('.cosmos-scene')).toHaveAttribute('data-scene-state', /^(webgl|poster|fallback)$/)
    await expect(page.getByTestId('dev-panel')).toHaveCount(0)
    await expect(page.locator('main#main')).toHaveCSS('opacity', '1')
    await page.evaluate(() => document.fonts.ready)
    if ('scroll' in vp) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const band = page.locator('.scene-ground img')
      await expect(band).toBeInViewport()
      await expect.poll(() => band.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    }
    await page.screenshot({
      path: `visual/output/snapshots/${vp.name}.png`,
      animations: 'disabled',
      caret: 'hide',
    })
    writeFileSync(`visual/output/snapshots/${vp.name}.anchors.json`, `${JSON.stringify(await readAnchors(page), null, 2)}\n`)
  })
}
