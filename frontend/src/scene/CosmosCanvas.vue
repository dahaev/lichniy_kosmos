<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'

import type { SceneOrientation } from './compositions'
import { forcedQualityTier, isDeterministicScene } from './deterministic'
import { computeFrame, type Size } from './layout'
import { plates } from './plates'
import { chooseQuality, readDeviceSignals } from './quality'
import type { SceneDirector } from './SceneDirector'
import ScenePoster from './ScenePoster.vue'
import { useSceneStore } from './sceneStore'

// The one persistent canvas of the app, mounted outside RouterView
// (ARCHITECTURE_MVP_v2 §17.1). The poster is always underneath, so the page
// is complete before Three.js loads and after WebGL fails.

const scene = useSceneStore()
const root = useTemplateRef<HTMLDivElement>('root')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

let director: SceneDirector | null = null
let resizeObserver: ResizeObserver | null = null
let unmounted = false
let viewport: Size | null = null

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')

const motionEnabled = computed(() => !scene.motionPaused)

/**
 * Mobile browsers change the viewport height when the address bar slides;
 * re-laying out the planet for that would make it jump while scrolling.
 */
function stableViewport(next: Size): Size {
  if (viewport && viewport.width === next.width && Math.abs(viewport.height - next.height) < 160) return viewport
  return next
}

function relayout(next: Size) {
  viewport = stableViewport(next)
  const orientation: SceneOrientation = viewport.height > viewport.width ? 'portrait' : 'landscape'
  scene.orientation = orientation
  const composition = scene.active
  const frame = computeFrame(viewport, composition.design, composition.planet, plates[composition.plate])
  scene.frame = frame

  const style = document.documentElement.style
  style.setProperty('--scene-u', `${String(frame.u)}px`)
  style.setProperty('--planet-x', `${String(frame.planet.x)}px`)
  style.setProperty('--planet-y', `${String(frame.planet.y)}px`)
  style.setProperty('--planet-r', `${String(frame.planet.r)}px`)
  style.setProperty('--horizon-y', `${String(frame.horizonY)}px`)
}

function measure(): Size {
  const rect = root.value?.getBoundingClientRect()
  return {
    width: Math.round(rect?.width || window.innerWidth),
    height: Math.round(rect?.height || window.innerHeight),
  }
}

function onVisibilityChange() {
  director?.setVisible(!document.hidden)
}

function onPointerMove(event: PointerEvent) {
  if (!viewport) return
  director?.setPointer((event.clientX / viewport.width) * 2 - 1, (event.clientY / viewport.height) * 2 - 1)
}

function onReducedMotionChange() {
  scene.motionPaused = reducedMotion.matches
}

function teardown() {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pointermove', onPointerMove)
  director?.dispose()
  director = null
}

function fallBack() {
  teardown()
  scene.state = 'fallback'
}

onMounted(async () => {
  // Synchronous first layout: the poster is placed before the first paint.
  relayout(measure())
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return
    relayout({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) })
    if (viewport) director?.resize(viewport.width, viewport.height, window.devicePixelRatio)
  })
  if (root.value) resizeObserver.observe(root.value)
  reducedMotion.addEventListener('change', onReducedMotionChange)

  const tier = forcedQualityTier(window.location.search) ?? chooseQuality(readDeviceSignals(window))
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
      deterministic: isDeterministicScene(window.location.search),
      onContextLost: fallBack,
    })
    director.compose(scene.composition)
    if (viewport) director.resize(viewport.width, viewport.height, window.devicePixelRatio)
    if (scene.frame) director.setLayout({ frame: scene.frame, composition: scene.active })
    director.setMotion(motionEnabled.value)

    document.addEventListener('visibilitychange', onVisibilityChange)
    if (finePointer.matches) window.addEventListener('pointermove', onPointerMove, { passive: true })

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
    if (viewport) relayout(viewport)
  },
)

watch(
  () => scene.frame,
  (frame) => {
    if (frame) director?.setLayout({ frame, composition: scene.active })
  },
)

watch(motionEnabled, (enabled) => {
  director?.setMotion(enabled)
})

onBeforeUnmount(() => {
  unmounted = true
  resizeObserver?.disconnect()
  resizeObserver = null
  reducedMotion.removeEventListener('change', onReducedMotionChange)
  teardown()
})
</script>

<template>
  <div
    ref="root"
    class="cosmos-scene"
    aria-hidden="true"
    :data-scene-state="scene.state"
    :data-scene-tier="scene.tier ?? 'pending'"
    :data-scene-composition="scene.composition"
    :data-scene-orientation="scene.orientation"
    :data-scene-ground="scene.active.ground"
    :data-scene-motion="scene.motionPaused ? 'paused' : 'running'"
  >
    <ScenePoster v-if="scene.frame" class="cosmos-scene__poster" :frame="scene.frame" :composition="scene.active" :vector-hidden="scene.state === 'webgl'" />
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

/*
 * Where the page owns the ground, the sky belongs to the top of the page and
 * scrolls away natively with it, so the text never slides over the planet.
 * While ambient motion runs it lingers at a quarter of the scroll speed
 * (net 0.75): depth for touch screens that have no pointer parallax. The
 * whole layer moves as one, so the WebGL orbits stay on the painted planet;
 * scroll-driven, so it runs on the compositor.
 */
.cosmos-scene[data-scene-ground='page'] {
  position: absolute;
}

@supports (animation-timeline: scroll()) {
  .cosmos-scene[data-scene-ground='page'][data-scene-motion='running'] {
    animation: cosmos-scene-linger linear both;
    animation-timeline: scroll(root);
    animation-range: 0 800px;
  }
}

@keyframes cosmos-scene-linger {
  to {
    transform: translateY(200px);
  }
}
</style>
