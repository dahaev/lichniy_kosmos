import { createRouter, createWebHistory, type Router, type RouterHistory } from 'vue-router'

import { guardAccess, guardIntake } from '@/features/intake/guard'

import { routes } from './routes'

const SITE_NAME = 'Личный космос'

const completedNavigations = new WeakMap<Router, number>()

export function documentTitle(title: string): string {
  return `${title} — ${SITE_NAME}`
}

/** True while the router is still on the page the user opened directly. */
export function isFirstNavigation(router: Router): boolean {
  return (completedNavigations.get(router) ?? 0) <= 1
}

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({ history, routes })

  router.beforeEach(guardIntake)
  router.beforeEach(guardAccess)

  router.afterEach((to, _from, failure) => {
    if (failure) return
    completedNavigations.set(router, (completedNavigations.get(router) ?? 0) + 1)
    document.title = documentTitle(to.meta.title)
  })

  return router
}
