import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { createApiClient, fetchConfig, type PublicConfig } from '@/api/client'
import { ApiProblem } from '@/api/problem'

/** Server-provided runtime configuration (GET /api/v1/config). */
export const useRuntimeConfig = defineStore('runtimeConfig', () => {
  const config = shallowRef<PublicConfig | null>(null)
  const mocked = ref(false)
  const error = shallowRef<ApiProblem | null>(null)

  async function load(client = createApiClient()) {
    try {
      const result = await fetchConfig(client)
      config.value = result.config
      mocked.value = result.mocked
      error.value = null
    } catch (e) {
      error.value = e instanceof ApiProblem ? e : new ApiProblem(0, 'unexpected_response', undefined, undefined, { cause: e })
    }
  }

  return { config, mocked, error, load }
})
