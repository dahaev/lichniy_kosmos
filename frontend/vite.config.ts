import { rm } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

const backend = process.env.COSMOS_BACKEND_URL ?? 'http://127.0.0.1:8080'

// The MSW worker lives in public/ for the dev server; production output must
// not ship it (ARCHITECTURE_MVP_v2 §16.6). scripts/check-bundle.mjs verifies.
function excludeMockWorker(): Plugin {
  let outDir = ''
  return {
    name: 'cosmos:exclude-mock-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      await rm(path.join(outDir, 'mockServiceWorker.js'), { force: true })
    },
  }
}

export default defineConfig({
  plugins: [vue(), excludeMockWorker()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/healthz': backend,
      '/readyz': backend,
    },
  },
  build: {
    sourcemap: true,
    // The lazily loaded Three.js chunk is ~530 kB raw / ~130 kB gzip; real
    // budgets are set with the V1 scene (ARCHITECTURE_MVP_v2 §17.2c).
    chunkSizeWarningLimit: 600,
  },
})
