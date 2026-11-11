<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useRuntimeConfig } from './runtimeConfig'
import { routes } from './routes'

// Development-only helper: shows where API data comes from and links every
// placeholder route. Never rendered in production builds (see App.vue).

const runtime = useRuntimeConfig()

const source = computed(() => {
  if (runtime.error) return `ошибка API: ${runtime.error.code}`
  if (!runtime.config) return 'загрузка…'
  return runtime.mocked ? 'MSW-моки' : 'реальный API'
})

const links = routes
  .filter((r) => r.name !== 'not-found')
  .map((r) => ({ to: r.path.replace(':id', 'demo'), label: `${r.meta?.screen ?? ''} ${r.path}` }))
</script>

<template>
  <details class="dev-panel" data-testid="dev-panel">
    <summary>
      S0 · данные: <span data-testid="api-source">{{ source }}</span>
    </summary>
    <nav aria-label="Маршруты разработки">
      <ul>
        <li v-for="link in links" :key="link.to">
          <RouterLink :to="link.to">{{ link.label }}</RouterLink>
        </li>
      </ul>
    </nav>
  </details>
</template>

<style scoped>
.dev-panel {
  position: fixed;
  right: 0.75rem;
  bottom: 0.75rem;
  z-index: var(--cosmos-z-overlay);
  max-width: min(22rem, calc(100vw - 1.5rem));
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--cosmos-line);
  border-radius: var(--cosmos-radius-sm);
  background: var(--cosmos-bg-raised);
  color: var(--cosmos-muted);
  font-size: 0.8125rem;
}

.dev-panel summary {
  cursor: pointer;
  min-height: 2rem;
  line-height: 2rem;
}

.dev-panel ul {
  max-height: 50vh;
  margin: 0.5rem 0 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.dev-panel a {
  display: block;
  padding: 0.25rem 0;
}
</style>
