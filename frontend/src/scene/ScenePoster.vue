<script setup lang="ts">
import { computed } from 'vue'

import type { SceneComposition } from './compositions'
import { bodyPosition, halfEllipsePath, orbitEllipse } from './geometry'
import type { SceneFrame } from './layout'
import { plates } from './plates'

// The still picture of a composition: the painted plate plus the vector
// layers WebGL would otherwise draw. It is the first paint, the static tier
// and the fallback after a lost context (ARCHITECTURE_MVP_v2 §17.1).

const props = defineProps<{
  frame: SceneFrame
  composition: SceneComposition
  /** Vector layers hand over to WebGL once it renders. */
  vectorHidden: boolean
}>()

const plate = computed(() => plates[props.composition.plate])

/** Plate rows over which the sky fades out when the screen draws the ground itself. */
const groundFade = 220

const plateStyle = computed(() => {
  const { x, y, width, height } = props.frame.plate
  const style: Record<string, string> = {
    transform: `translate(${String(x)}px, ${String(y)}px)`,
    width: `${String(width)}px`,
    height: `${String(height)}px`,
  }
  const groundTop = plate.value.groundTop
  if (props.composition.ground === 'page' && groundTop !== null) {
    const scale = props.frame.scale
    const mask = `linear-gradient(to bottom, #000 ${String((groundTop - groundFade) * scale)}px, transparent ${String(groundTop * scale)}px)`
    style.maskImage = mask
    style.webkitMaskImage = mask
  }
  return style
})

const sizes = computed(() => `${String(Math.ceil(props.frame.plate.width))}px`)

const orbits = computed(() =>
  props.composition.orbits.radii.map((_, i) => {
    const e = orbitEllipse(props.frame.planet, props.composition.orbits, i)
    return { near: halfEllipsePath(e, false), far: halfEllipsePath(e, true) }
  }),
)

const bodies = computed(() =>
  props.composition.bodies.map((body) => ({
    kind: body.kind,
    r: (body.size * props.frame.u) / 2,
    ...bodyPosition(props.frame.planet, props.composition.orbits, body, 0),
  })),
)

const strokeWidth = computed(() => props.composition.orbits.width * props.frame.u)
const opacity = computed(() => props.composition.orbits.opacity)
</script>

<template>
  <div class="scene-poster">
    <picture :key="plate.id">
      <source type="image/avif" :srcset="plate.srcset.avif" :sizes="sizes" />
      <source type="image/webp" :srcset="plate.srcset.webp" :sizes="sizes" />
      <img class="scene-poster__plate" :src="plate.src" alt="" decoding="async" fetchpriority="high" :style="plateStyle" />
    </picture>
    <svg
      class="scene-poster__vector"
      :viewBox="`0 0 ${String(frame.viewport.width)} ${String(frame.viewport.height)}`"
      :width="frame.viewport.width"
      :height="frame.viewport.height"
      :style="{ opacity: vectorHidden ? 0 : composition.intensity }"
    >
      <defs>
        <clipPath id="scene-planet-disk">
          <circle :cx="frame.planet.x" :cy="frame.planet.y" :r="frame.planet.r" />
        </clipPath>
        <mask id="scene-outside-planet" maskUnits="userSpaceOnUse" x="0" y="0" :width="frame.viewport.width" :height="frame.viewport.height">
          <rect :width="frame.viewport.width" :height="frame.viewport.height" fill="#fff" />
          <circle :cx="frame.planet.x" :cy="frame.planet.y" :r="frame.planet.r" fill="#000" />
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
          <path :d="orbit.far" clip-path="url(#scene-planet-disk)" :stroke-opacity="opacity * composition.orbits.backOverPlanet" />
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

.scene-poster__plate {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  transform-origin: 0 0;
}

.scene-poster__vector {
  position: absolute;
  inset: 0;
  transition: opacity var(--cosmos-dur-route) var(--cosmos-ease-out);
}
</style>
