import type { RouteRecordRaw } from 'vue-router'

import type { CompositionName } from '@/scene/compositions'

declare module 'vue-router' {
  interface RouteMeta {
    /** Screen id from docs/frontend/SCREEN_SPEC_MVP_v2.md §2. */
    screen: string
    title: string
    scene: CompositionName
    /** Slice of ARCHITECTURE_MVP_v2 §23 that builds the real screen. */
    slice: string
  }
}

const StubView = () => import('./views/StubView.vue')
const NotFoundView = () => import('./views/NotFoundView.vue')

/**
 * Every MVP route exists from S0 so links and guards can be wired early.
 * Each one renders a neutral placeholder until its slice replaces it.
 */
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: StubView, meta: { screen: 'SCR-01', title: 'Главная', scene: 'hero', slice: 'V1' } },
  { path: '/create', name: 'create', component: StubView, meta: { screen: 'SCR-02', title: 'Анкета рождения', scene: 'intake', slice: 'V1–V2' } },
  { path: '/create/review', name: 'create-review', component: StubView, meta: { screen: 'SCR-03', title: 'Проверка данных', scene: 'review', slice: 'V2' } },
  { path: '/create/access', name: 'create-access', component: StubView, meta: { screen: 'SCR-04', title: 'Доступ к разбору', scene: 'access', slice: '5' } },
  { path: '/create/consent', name: 'create-consent', component: StubView, meta: { screen: 'SCR-05', title: 'Подтверждение', scene: 'access', slice: '6' } },
  { path: '/orders/:id/creating', name: 'order-creating', component: StubView, meta: { screen: 'SCR-06', title: 'Построение карты', scene: 'creation', slice: 'V3, 8' } },
  { path: '/orders/:id', name: 'order', component: StubView, meta: { screen: 'SCR-07', title: 'Ваш разбор', scene: 'result', slice: 'V3, 11' } },
  { path: '/login', name: 'login', component: StubView, meta: { screen: 'SCR-08', title: 'Вход по почте', scene: 'quiet', slice: '7' } },
  { path: '/login/verify', name: 'login-verify', component: StubView, meta: { screen: 'SCR-08', title: 'Код из письма', scene: 'quiet', slice: '7' } },
  { path: '/account', name: 'account', component: StubView, meta: { screen: 'SCR-09', title: 'Кабинет', scene: 'quiet', slice: '7' } },
  { path: '/activate', name: 'activate', component: StubView, meta: { screen: 'SCR-10', title: 'Активация кода', scene: 'access', slice: '5' } },
  { path: '/natal-chart', name: 'natal-chart', component: StubView, meta: { screen: 'SCR-11', title: 'Натальная карта', scene: 'quiet', slice: '11' } },
  { path: '/example', name: 'example', component: StubView, meta: { screen: 'SCR-12', title: 'Пример разбора', scene: 'quiet', slice: '11' } },
  { path: '/support', name: 'support', component: StubView, meta: { screen: 'SCR-13', title: 'Поддержка', scene: 'quiet', slice: '11' } },
  { path: '/legal/privacy', name: 'legal-privacy', component: StubView, meta: { screen: 'SCR-14', title: 'Политика конфиденциальности', scene: 'quiet', slice: '11' } },
  { path: '/legal/terms', name: 'legal-terms', component: StubView, meta: { screen: 'SCR-14', title: 'Условия использования', scene: 'quiet', slice: '11' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { screen: 'SCR-15', title: 'Страница не найдена', scene: 'quiet', slice: 'S0' } },
]
