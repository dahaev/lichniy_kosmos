import { defineConfig, devices } from '@playwright/test'

const port = 4173
const baseURL = `http://127.0.0.1:${port}`

// The production bundle (`vite build`) served by `vite preview`: no dev server,
// no MSW. The API is answered by the specs themselves through `page.route`, so
// they can play a server that opens order creation. Run `make e2e-prod`.
export default defineConfig({
  testDir: 'production',
  outputDir: 'test-results-prod',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${String(port)} --strictPort`,
    cwd: '../frontend',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
