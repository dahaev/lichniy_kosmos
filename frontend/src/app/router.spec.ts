import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { useIntakeDraft } from '@/features/intake/draft'
import { sceneOf } from '@/features/intake/guard'
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
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

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

  it('addresses intake steps by query and never opens one past the first unanswered question', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/create')
    expect(router.currentRoute.value.fullPath).toBe('/create?step=name')

    await router.push('/create?step=time')
    expect(router.currentRoute.value.query.step).toBe('name')

    useIntakeDraft().draft.name = 'Анна'
    await router.push('/create?step=time')
    expect(router.currentRoute.value.query.step).toBe('date')

    await router.push('/create?step=nonsense')
    expect(router.currentRoute.value.query.step).toBe('name')
  })

  it('opens the review only for a complete draft, else the first unanswered step in edit mode', async () => {
    const router = createAppRouter(createMemoryHistory())
    const { draft } = useIntakeDraft()

    await router.push('/create/review')
    expect(router.currentRoute.value.fullPath).toBe('/create?step=name&from=review')

    Object.assign(draft, {
      name: 'Анна',
      date: { day: '12', month: '03', year: '1990' },
      place: { query: 'Казань', selected: { id: 'ru-kzn', name: 'Казань', country: 'Россия' } },
    })
    await router.push('/create/review')
    expect(router.currentRoute.value.fullPath).toBe('/create?step=time&from=review')

    Object.assign(draft.time, { kind: 'unknown', source: 'unknown', accuracy: 0 })
    await router.push('/create/review')
    expect(router.currentRoute.value.path).toBe('/create/review')
  })

  it('keeps the edit flag when a step link is corrected', async () => {
    const router = createAppRouter(createMemoryHistory())

    await router.push('/create?step=time&from=review')
    expect(router.currentRoute.value.fullPath).toBe('/create?step=name&from=review')
  })

  it('gives each intake step its own scene frame', () => {
    const router = createAppRouter(createMemoryHistory())
    expect(sceneOf(router.resolve('/create?step=place'))).toBe('intake.place')
    expect(sceneOf(router.resolve('/'))).toBe('hero')
  })
})
