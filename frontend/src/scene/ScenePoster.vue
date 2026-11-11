<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import type { SceneComposition } from './compositions'
import { bodyPosition, halfEllipsePath, orbitEllipse } from './geometry'
import type { SceneSnapshot } from './interpolate'
import type { Size } from './layout'
import { platePlacement, plateTransform, type PlatePlacement } from './placement'
import { plates } from './plates'

// The still picture of a composition: the painted plate plus the vector
// layers WebGL would otherwise draw. It is the first paint, the static tier
// and the fallback after a lost context (ARCHITECTURE_MVP_v2 §17.1).
//
// The plate is placed imperatively through place(): during a camera move
// SceneDirector (or CosmosCanvas on the static tier) calls it every frame,
// and Vue must not write a stale transform back in between.

const props = defineProps<{
  viewport: Size
  composition: SceneComposition
  /** The scene at rest, for the vector layer. */
  rest: SceneSnapshot
  /**
   * Plate scale of the hero, the largest of all frames: the box is laid out
   * at it, so the hero needs no scale transform and other frames only shrink.
   */
  baseScale: number
  /** Vector layers hand over to WebGL once it renders. */
  vectorHidden: boolean
  /** The static tier hides the vector layer while the plate moves under it. */
  vectorMoving: boolean
}>()

const plate = computed(() => plates[props.composition.plate])

const box = useTemplateRef<HTMLDivElement>('box')
const groundVeil = useTemplateRef<HTMLDivElement>('groundVeil')
const leftVeil = useTemplateRef<HTMLDivElement>('leftVeil')
const bottomVeil = useTemplateRef<HTMLDivElement>('bottomVeil')

let last: SceneSnapshot = props.rest

function apply(placement: PlatePlacement) {
  if (box.value) box.value.style.transform = plateTransform(placement, props.baseScale)
  if (groundVeil.value) groundVeil.value.style.opacity = String(placement.groundVeil)
  for (const veil of [leftVeil.value, bottomVeil.value]) if (veil) veil.style.opacity = String(placement.edgeVeil)
}

function place(snapshot: SceneSnapshot) {
  last = snapshot
  apply(platePlacement(snapshot, plate.value))
}

/** Reduced motion: the old placement stays on top and fades out over the new one. */
const ghost = ref<{ key: number; placement: PlatePlacement; src: string } | null>(null)
let ghostKey = 0

function crossfade() {
  // The file the browser already chose and decoded: no new download, no blank ghost.
  const src = box.value?.querySelector('img')?.currentSrc || plate.value.src
  ghost.value = { key: ++ghostKey, placement: platePlacement(last, plate.value), src }
}

defineExpose({ place, crossfade })

// A new plate (orientation change) remounts the box: place it again.
watch(
  () => plate.value.id,
  async () => {
    await nextTick()
    place(last)
  },
  { flush: 'post' },
)

watch(box, (el) => {
  if (el) place(last)
})

// A new layout size (resize) changes what the same transform means.
watch(
  () => props.baseScale,
  async () => {
    await nextTick()
    place(last)
  },
  { flush: 'post' },
)

const boxStyle = computed(() => ({
  width: `${String(plate.value.width * props.baseScale)}px`,
  height: `${String(plate.value.height * props.baseScale)}px`,
}))

const FEATHER_STOPS = 8

const groundVeilStyle = computed(() => {
  const { groundTop, groundFade, groundFeather } = plate.value
  const k = props.baseScale
  const top = `${String((groundTop - groundFade) * k)}px`
  const linear = `linear-gradient(to bottom, transparent, var(--cosmos-bg) ${String(groundFade * k)}px)`
  if (groundFeather <= 0) return { top, '--veil-linear': linear, '--veil-eased': linear }
  // A smoothstep ramp: a linear one leaves a visible band where it meets the
  // solid sky colour, right under the mountains.
  const length = (groundFade + groundFeather) * k
  const stops = Array.from({ length: FEATHER_STOPS + 1 }, (_, i) => {
    const t = i / FEATHER_STOPS
    const alpha = t * t * (3 - 2 * t)
    return `color-mix(in srgb, var(--cosmos-bg) ${(alpha * 100).toFixed(1)}%, transparent) ${(t * length).toFixed(1)}px`
  })
  return { top, '--veil-linear': linear, '--veil-eased': `linear-gradient(to bottom, ${stops.join(', ')})` }
})

const ghostStyle = computed(() => {
  if (!ghost.value) return {}
  return { ...boxStyle.value, transform: plateTransform(ghost.value.placement, props.baseScale) }
})

const sizes = computed(() => `${String(Math.ceil(plate.value.width * props.baseScale))}px`)

const orbits = computed(() =>
  props.rest.orbits.radii.map((_, i) => {
    const e = orbitEllipse(props.rest.planet, props.rest.orbits, i)
    return { near: halfEllipsePath(e, false), far: halfEllipsePath(e, true) }
  }),
)

const bodies = computed(() =>
  props.composition.bodies.map((body) => ({
    kind: body.kind,
    r: (body.size * props.rest.u * props.rest.bodyScale) / 2,
    ...bodyPosition(props.rest.planet, props.rest.orbits, body, 0, props.rest.bodyPhase),
  })),
)

const strokeWidth = computed(() => props.rest.orbits.width * props.rest.u)
const opacity = computed(() => props.rest.orbits.opacity)
const vectorOpacity = computed(() => (props.vectorHidden || props.vectorMoving ? 0 : props.rest.intensity))
</script>

<template>
  <div class="scene-poster">
    <div :key="plate.id" ref="box" class="scene-poster__plate" :style="boxStyle">
      <picture>
        <source type="image/avif" :srcset="plate.srcset.avif" :sizes="sizes" />
        <source type="image/webp" :srcset="plate.srcset.webp" :sizes="sizes" />
        <img class="scene-poster__image" :src="plate.src" alt="" decoding="async" fetchpriority="high" />
      </picture>
      <div ref="groundVeil" class="scene-poster__ground-veil" :style="groundVeilStyle" />
      <div ref="leftVeil" class="scene-poster__edge scene-poster__edge--left" />
      <div ref="bottomVeil" class="scene-poster__edge scene-poster__edge--bottom" />
    </div>
    <div
      v-if="ghost"
      :key="`ghost-${ghost.key}`"
      class="scene-poster__plate scene-poster__ghost"
      :style="ghostStyle"
      @animationend="ghost = null"
    >
      <img class="scene-poster__image" :src="ghost.src" alt="" />
      <div class="scene-poster__ground-veil" :style="[groundVeilStyle, { opacity: ghost.placement.groundVeil }]" />
      <div class="scene-poster__edge scene-poster__edge--left" :style="{ opacity: ghost.placement.edgeVeil }" />
      <div class="scene-poster__edge scene-poster__edge--bottom" :style="{ opacity: ghost.placement.edgeVeil }" />
    </div>
    <svg
      class="scene-poster__vector"
      :class="{ 'is-moving': vectorMoving }"
      :viewBox="`0 0 ${String(viewport.width)} ${String(viewport.height)}`"
      :width="viewport.width"
      :height="viewport.height"
      :style="{ opacity: vectorOpacity }"
    >
      <defs>
        <clipPath id="scene-planet-disk">
          <circle :cx="rest.planet.x" :cy="rest.planet.y" :r="rest.planet.r" />
        </clipPath>
        <mask id="scene-outside-planet" maskUnits="userSpaceOnUse" x="0" y="0" :width="viewport.width" :height="viewport.height">
          <rect :width="viewport.width" :height="viewport.height" fill="#fff" />
          <circle :cx="rest.planet.x" :cy="rest.planet.y" :r="rest.planet.r" fill="#000" />
        </mask>
        <radialGradient id="scene-glow">
          <stop offset="0" stop-color="#fff3dc" stop-opacity="0.42" />
          <stop offset="1" stop-color="#fff3dc" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="scene-moon" cx="0.72" cy="0.4" r="0.9">
          <stop offset="0" stop-color="#f5d6a8" />
          <stop offset="0.55" stop-color="#8a7560" />
          <stop offset="1" stop-color="#12151b" />
        </radialGradient>
      </defs>
      <g fill="none" stroke="#ede8dc" :stroke-width="strokeWidth" :stroke-opacity="opacity">
        <template v-for="(orbit, i) in orbits" :key="i">
          <path :d="orbit.near" />
          <path :d="orbit.far" mask="url(#scene-outside-planet)" />
          <path :d="orbit.far" clip-path="url(#scene-planet-disk)" :stroke-opacity="opacity * rest.orbits.backOverPlanet" />
        </template>
      </g>
      <template v-for="(body, i) in bodies" :key="i">
        <g v-if="body.kind === 'glow'">
          <circle :cx="body.x" :cy="body.y" :r="body.r * 7" fill="url(#scene-glow)" />
          <circle :cx="body.x" :cy="body.y" :r="body.r" fill="#fff3dc" />
        </g>
        <circle v-else :cx="body.x" :cy="body.y" :r="body.r" fill="url(#scene-moon)" />
      </template>
    </svg>
  </div>
</template>

<style scoped>
.scene-poster {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--cosmos-bg);
}

/* Sized in plate pixels and moved by one transform; the veils ride along. */
.scene-poster__plate {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.scene-poster__image {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
}

/*
 * Veils extend past the plate box: where the camera pulled back, the open
 * edges and the hidden ground melt into the sky colour without a seam.
 */
.scene-poster__ground-veil {
  position: absolute;
  right: -1200px;
  bottom: -1200px;
  left: -1200px;
  background: var(--veil-linear);
  opacity: 0;
}

/* Safari < 16.2 and Chrome < 111 keep the linear veil: an unsupported value would drop the veil entirely. */
@supports (color: color-mix(in srgb, red 50%, transparent)) {
  .scene-poster__ground-veil {
    background: var(--veil-eased);
  }
}

.scene-poster__edge {
  position: absolute;
  opacity: 0;
}

.scene-poster__edge--left {
  top: -1200px;
  bottom: -1200px;
  left: -1200px;
  width: 1440px;
  background: linear-gradient(to right, var(--cosmos-bg) 1200px, transparent);
}

.scene-poster__edge--bottom {
  right: -1200px;
  bottom: -1200px;
  left: -1200px;
  height: 1440px;
  background: linear-gradient(to bottom, transparent, var(--cosmos-bg) 240px);
}

.scene-poster__ghost {
  animation: scene-poster-ghost var(--cosmos-dur-route) var(--cosmos-ease-out) forwards;
}

@keyframes scene-poster-ghost {
  to {
    opacity: 0;
  }
}

.scene-poster__vector {
  position: absolute;
  inset: 0;
  transition: opacity var(--cosmos-dur-route) var(--cosmos-ease-out);
}

.scene-poster__vector.is-moving {
  transition-duration: 150ms;
}
</style>
