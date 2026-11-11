import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { compositionNames } from '@/scene/compositions'

import { createAppRouter, documentTitle, isFirstNavigation } from './router'
import { routes } from './routes'

// SCREEN_SPEC_MVP_v2 §2: every MVP screen has an addressable route.
const screenPaths: [string, string][] = [
  ['/', 'SCR-01'],
  ['/create', 'SCR-02'],
  ['/create/review', 'SCR-03'],
  ['/create/access', 'SCR-04'],
  ['/create/consent', 'SCR-05'],
  ['/orders/demo/creating', 'SCR-06'],
  ['/orders/demo', 'SCR-07'],
  ['/login', 'SCR-08'],
  ['/login/verify', 'SCR-08'],
  ['/account', 'SCR-09'],
  ['/activate', 'SCR-10'],
  ['/natal-chart', 'SCR-11'],
  ['/example', 'SCR-12'],
  ['/support', 'SCR-13'],
  ['/legal/privacy', 'SCR-14'],
  ['/legal/terms', 'SCR-14'],
  ['/definitely/missing', 'SCR-15'],
]

describe('router', () => {
  it.each(screenPaths)('%s resolves to %s', (path, screen) => {
    const router = createAppRouter(createMemoryHistory())
    expect(router.resolve(path).meta.screen).toBe(screen)
  })

  it('assigns a known scene composition to every route', () => {
    for (const route of routes) {
      expect(compositionNames).toContain(route.meta?.scene)
    }
  })

  it('updates the document title and counts navigations', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/support')
    expect(document.title).toBe(documentTitle('Поддержка'))
    expect(isFirstNavigation(router)).toBe(true)

    await router.push('/create')
    expect(document.title).toBe(documentTitle('Анкета рождения'))
    expect(isFirstNavigation(router)).toBe(false)
  })
})
