<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'

import { isDeterministicScene } from './deterministic'
import { chooseQuality, readDeviceSignals } from './quality'
import type { SceneDirector } from './SceneDirector'
import { useSceneStore } from './sceneStore'

// The one persistent canvas of the app, mounted outside RouterView
// (ARCHITECTURE_MVP_v2 §17.1). The poster is always underneath, so the page
// is complete before Three.js loads and after WebGL fails.

const scene = useSceneStore()
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

let director: SceneDirector | null = null
let resizeObserver: ResizeObserver | null = null
let unmounted = false

function onVisibilityChange() {
  director?.setVisible(!document.hidden)
}

function teardown() {
  resizeObserver?.disconnect()
  resizeObserver = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
  director?.dispose()
  director = null
}

function fallBack() {
  teardown()
  scene.state = 'fallback'
}

onMounted(async () => {
  const tier = chooseQuality(readDeviceSignals(window))
  scene.tier = tier
  const el = canvas.value
  if (tier === 'static' || !el) {
    scene.state = 'poster'
    return
  }

  try {
    const { SceneDirector } = await import('./SceneDirector')
    if (unmounted) return

    director = new SceneDirector({
      canvas: el,
      tier,
      background: getComputedStyle(document.documentElement).getPropertyValue('--cosmos-bg').trim() || '#07111d',
      deterministic: isDeterministicScene(window.location.search),
      onContextLost: fallBack,
    })
    director.compose(scene.composition)

    resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return
      director?.resize(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio)
    })
    resizeObserver.observe(el)
    document.addEventListener('visibilitychange', onVisibilityChange)

    director.setVisible(!document.hidden)
    scene.state = 'webgl'
  } catch {
    fallBack()
  }
})

watch(
  () => scene.composition,
  (name) => {
    director?.compose(name)
  },
)

onBeforeUnmount(() => {
  unmounted = true
  teardown()
})
</script>

<template>
  <div class="cosmos-scene" aria-hidden="true" :data-scene-state="scene.state" :data-scene-tier="scene.tier ?? 'pending'" :data-scene-composition="scene.composition">
    <div class="cosmos-scene__poster" />
    <canvas ref="canvas" class="cosmos-scene__canvas" :class="{ 'is-active': scene.state === 'webgl' }" />
  </div>
</template>

<style scoped>
.cosmos-scene {
  position: fixed;
  inset: 0;
  z-index: var(--cosmos-z-scene);
  pointer-events: none;
  background: var(--cosmos-bg);
}

/* Final poster art (AVIF/WebP) arrives with the V1 assets. */
.cosmos-scene__poster {
  position: absolute;
  inset: 0;
  background: var(--cosmos-bg);
}

.cosmos-scene__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity var(--cosmos-dur-route) var(--cosmos-ease-out);
}

.cosmos-scene__canvas.is-active {
  opacity: 1;
}
</style>
