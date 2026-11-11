<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import { durations, easings } from '@/motion/tokens'

import { compositions, type CompositionName } from './compositions'
import { forcedQualityTier, isDeterministicScene } from './deterministic'
import { cubicBezier, mixSnapshots, snapshotOf, type SceneSnapshot } from './interpolate'
import type { Size } from './layout'
import { chooseQuality, readDeviceSignals } from './quality'
import type { SceneDirector, SceneLayout } from './SceneDirector'
import ScenePoster from './ScenePoster.vue'
import { frameOf, useSceneStore } from './sceneStore'
import { SnapshotTween, type SceneTransition } from './tween'

// The one persistent canvas of the app, mounted outside RouterView
// (ARCHITECTURE_MVP_v2 §17.1). The poster is always underneath, so the page
// is complete before Three.js loads and after WebGL fails. Composition
// changes become camera moves (SCR-02 journal, §2): SceneDirector flies on
// WebGL tiers, a transient loop here moves the poster plate on the static tier.

const scene = useSceneStore()
const root = useTemplateRef<HTMLDivElement>('root')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const poster = useTemplateRef<InstanceType<typeof ScenePoster>>('poster')

let director: SceneDirector | null = null
let resizeObserver: ResizeObserver | null = null
let unmounted = false
let posterLoop = 0
let flightEnd = 0
const posterTween = new SnapshotTween()

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')

const motionEnabled = computed(() => !scene.motionPaused)
const moving = ref(false)
/** Reduced motion: WebGL layers vanish for the cut and fade back in. */
const canvasCut = ref(false)

const heroFrame = computed(() => scene.frameFor('hero'))
/** Planet centre of the hero: the star field rests there. */
const origin = computed(() => heroFrame.value?.planet ?? { x: 0, y: 0 })
const baseScale = computed(() => heroFrame.value?.scale ?? 1)

const layout = computed<SceneLayout | null>(() => (scene.frame ? { frame: scene.frame, composition: scene.active, origin: origin.value } : null))
const rest = computed<SceneSnapshot | null>(() => (layout.value ? snapshotOf(layout.value.frame, layout.value.composition, layout.value.origin) : null))

/**
 * Mobile browsers change the viewport height when the address bar slides or
 * the keyboard opens; re-laying out the planet for that would make it jump.
 */
function stableViewport(next: Size): Size {
  const current = scene.viewport
  if (!current || current.width !== next.width) return next
  const typing = document.activeElement instanceof HTMLInputElement
  if (Math.abs(current.height - next.height) < 160 || (typing && next.height < current.height)) return current
  return next
}

function relayout(next: Size) {
  const viewport = stableViewport(next)
  if (viewport === scene.viewport) return
  scene.orientation = viewport.height > viewport.width ? 'portrait' : 'landscape'
  scene.viewport = viewport
  publishPlanet()
}

/**
 * Screens that pin captions to the planet (the hero) read these variables.
 * They follow only compositions that cover the screen, so a leaving hero
 * keeps its captions in place while the camera already flies to the intake.
 */
function publishPlanet() {
  const frame = scene.frame
  if (!frame || scene.active.coverage !== 'cover') return
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

function isIntake(name: CompositionName): boolean {
  return name.startsWith('intake.')
}

/** SCR-02 §2.1: between two intake steps a step move, anything else a route move; phones fly shorter. */
function transitionFor(from: CompositionName, to: CompositionName, shiftY: number): SceneTransition {
  const step = isIntake(from) && isIntake(to)
  // Back to the hero is calmer and shorter than the way in (SCR-02 §2.2).
  const base = step ? durations.cameraStep : to === 'hero' ? durations.camera : durations.cameraRoute
  const factor = scene.orientation === 'portrait' ? (step ? 0.9 : 0.8) : 1
  return { duration: Math.round(base * factor), easing: easings.cinematic, fromShiftY: shiftY }
}

function setMoving(value: boolean) {
  if (moving.value !== value) moving.value = value
}

function onPlate(snapshot: SceneSnapshot) {
  poster.value?.place(snapshot)
  setMoving(director?.moving ?? false)
}

function runPoster(now: number) {
  const active = posterTween.step(now)
  if (posterTween.current) poster.value?.place(posterTween.current)
  setMoving(active)
  posterLoop = active ? requestAnimationFrame(runPoster) : 0
}

/** Shows the current layout: a camera move with `transition`, a cut without one. */
function show(transition?: SceneTransition) {
  const target = layout.value
  if (!target) return
  flightEnd = transition ? performance.now() + transition.duration : 0
  if (director) {
    director.setLayout(target, transition)
    return
  }
  const snapshot = rest.value
  if (!snapshot) return
  if (transition && !isDeterministicScene(window.location.search)) {
    posterTween.retarget(snapshot, transition, performance.now())
    cancelAnimationFrame(posterLoop)
    posterLoop = requestAnimationFrame(runPoster)
  } else {
    cancelAnimationFrame(posterLoop)
    posterTween.snap(snapshot)
    poster.value?.place(snapshot)
    setMoving(false)
  }
}

/** Reduced motion (MOTION_SPEC §5): no flight; the new frame fades in over the old one. */
function cut() {
  poster.value?.crossfade()
  canvasCut.value = true
  show()
  // Two frames: the hidden canvas must be styled once before it fades back in.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      canvasCut.value = false
    })
  })
}

function onVisibilityChange() {
  director?.setVisible(!document.hidden)
}

function onPointerMove(event: PointerEvent) {
  const viewport = scene.viewport
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
  // The poster continues from wherever the camera was.
  const snapshot = director?.snapshot
  teardown()
  scene.state = 'fallback'
  if (snapshot) posterTween.snap(snapshot)
  const left = Math.round(flightEnd - performance.now())
  show(left > 0 ? { duration: left, easing: easings.cinematic } : undefined)
}

/**
 * Dev and visual tests only: freezes the scene at `progress` of the flight
 * between two compositions, for owner review of key frames.
 */
function installPreview() {
  if (!import.meta.env.DEV) return
  ;(window as Window & { __cosmosScene?: unknown }).__cosmosScene = {
    preview(from: CompositionName, to: CompositionName, progress: number) {
      const viewport = scene.viewport
      if (!viewport) return
      const at = (name: CompositionName): SceneLayout => {
        const composition = compositions[name][scene.orientation]
        return { frame: frameOf(viewport, composition), composition, origin: origin.value }
      }
      const transition = transitionFor(from, to, 0)
      if (director) {
        director.preview(at(from), at(to), progress, transition)
        return
      }
      const a = at(from)
      const b = at(to)
      const mixed = mixSnapshots(snapshotOf(a.frame, a.composition, a.origin), snapshotOf(b.frame, b.composition, b.origin), cubicBezier(transition.easing)(progress))
      posterTween.snap(mixed)
      poster.value?.place(mixed)
    },
  }
}

onMounted(async () => {
  // Synchronous first layout: the poster is placed before the first paint.
  relayout(measure())
  show()
  installPreview()
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return
    relayout({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) })
    const viewport = scene.viewport
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
      onPlate,
    })
    const viewport = scene.viewport
    if (viewport) director.resize(viewport.width, viewport.height, window.devicePixelRatio)
    show()
    director.setMotion(motionEnabled.value)

    document.addEventListener('visibilitychange', onVisibilityChange)
    if (finePointer.matches) window.addEventListener('pointermove', onPointerMove, { passive: true })

    director.setVisible(!document.hidden)
    scene.state = 'webgl'
  } catch {
    fallBack()
  }
})

// Measured before the DOM update: a page-owned sky (portrait hero) scrolls
// with the page, and the flight must start where the visitor sees it.
watch(
  () => scene.composition,
  (name, previous) => {
    publishPlanet()
    const was = compositions[previous][scene.orientation]
    const shiftY = was.ground === 'page' && scene.active.ground !== 'page' ? (root.value?.getBoundingClientRect().top ?? 0) : 0
    if (reducedMotion.matches) {
      cut()
      return
    }
    show(transitionFor(previous, name, shiftY))
  },
  { flush: 'pre' },
)

// A resize mid-flight (a scrollbar that goes away with the old page) bends
// the camera to the new target in the time left instead of cutting.
watch([() => scene.viewport, () => scene.orientation], () => {
  const left = Math.round(flightEnd - performance.now())
  show(moving.value && left > 0 ? { duration: left, easing: easings.cinematic } : undefined)
})

watch(motionEnabled, (enabled) => {
  director?.setMotion(enabled)
})

onBeforeUnmount(() => {
  unmounted = true
  cancelAnimationFrame(posterLoop)
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
    :data-scene-moving="moving ? 'true' : 'false'"
  >
    <ScenePoster
      v-if="scene.viewport && rest"
      ref="poster"
      class="cosmos-scene__poster"
      :viewport="scene.viewport"
      :composition="scene.active"
      :rest="rest"
      :base-scale="baseScale"
      :vector-hidden="scene.state === 'webgl'"
      :vector-moving="moving"
    />
    <canvas ref="canvas" class="cosmos-scene__canvas" :class="{ 'is-active': scene.state === 'webgl', 'is-cut': canvasCut }" />
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

/* Its own layer only while flying: at rest the plate rasterises exactly as on the approved home. */
.cosmos-scene[data-scene-moving='true'] :deep(.scene-poster__plate) {
  will-change: transform;
}

.cosmos-scene__canvas.is-cut {
  opacity: 0;
  transition: none;
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
