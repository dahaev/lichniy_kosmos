import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './app/App.vue'
import { createAppRouter } from './app/router'
import './ui/tokens.css'
import './ui/base.css'

// MSW runs only in the dev server with VITE_API_MOCKS=1. The DEV check is a
// compile-time constant, so production builds drop the import entirely.
async function enableApiMocks(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_API_MOCKS !== '1') return
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

async function bootstrap(): Promise<void> {
  await enableApiMocks()

  const app = createApp(App)
  const router = createAppRouter()
  app.use(createPinia())
  app.use(router)
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
