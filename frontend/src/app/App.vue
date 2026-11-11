<script setup lang="ts">
import { AnimatePresence, MotionConfig } from 'motion-v'
import { defineAsyncComponent, onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import { sceneOf } from '@/features/intake/guard'
import CosmosCanvas from '@/scene/CosmosCanvas.vue'
import { isDeterministicScene } from '@/scene/deterministic'
import { useSceneStore } from '@/scene/sceneStore'
import SkipLink from '@/ui/SkipLink.vue'

import RouteAnnouncer from './RouteAnnouncer.vue'
import { preloadIntake } from './routes'
import { useRuntimeConfig } from './runtimeConfig'

const route = useRoute()
const scene = useSceneStore()
const runtime = useRuntimeConfig()

const DevPanel =
  import.meta.env.DEV && !isDeterministicScene(window.location.search)
    ? defineAsyncComponent(() => import('./DevPanel.vue'))
    : null

watch(
  () => sceneOf(route),
  (name) => {
    scene.compose(name)
  },
  { immediate: true },
)

onMounted(() => {
  void runtime.load()
  // Safari has no requestIdleCallback.
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => void preloadIntake())
  else setTimeout(() => void preloadIntake(), 1500)
})
</script>

<template>
  <MotionConfig reduced-motion="user">
    <SkipLink />
    <CosmosCanvas />
    <RouterView v-slot="{ Component, route: current }">
      <AnimatePresence mode="wait">
        <component :is="Component" :key="current.path" />
      </AnimatePresence>
    </RouterView>
    <RouteAnnouncer />
    <component :is="DevPanel" v-if="DevPanel" />
  </MotionConfig>
</template>
