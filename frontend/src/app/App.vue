<script setup lang="ts">
import { AnimatePresence, MotionConfig } from 'motion-v'
import { defineAsyncComponent, onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import CosmosCanvas from '@/scene/CosmosCanvas.vue'
import { isDeterministicScene } from '@/scene/deterministic'
import { useSceneStore } from '@/scene/sceneStore'
import SkipLink from '@/ui/SkipLink.vue'

import RouteAnnouncer from './RouteAnnouncer.vue'
import { useRuntimeConfig } from './runtimeConfig'

const route = useRoute()
const scene = useSceneStore()
const runtime = useRuntimeConfig()

const DevPanel =
  import.meta.env.DEV && !isDeterministicScene(window.location.search)
    ? defineAsyncComponent(() => import('./DevPanel.vue'))
    : null

watch(
  () => route.meta.scene,
  (name) => {
    scene.compose(name)
  },
  { immediate: true },
)

onMounted(() => {
  void runtime.load()
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
