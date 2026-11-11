<script setup lang="ts">
import { computed } from 'vue'

import type { SceneComposition } from './compositions'
import type { SceneFrame } from './layout'
import { plates } from './plates'

// The lower band of a plate (haze, mountains, water) for compositions whose
// screen owns the ground. Same file, scale and horizontal placement as the
// scene poster, so the band reads as the rest of the same picture; it lives
// in the page flow and scrolls natively with the text laid over it.

const props = defineProps<{
  frame: SceneFrame
  composition: SceneComposition
  /** Rises slightly as it scrolls into view; off while background motion is paused. */
  drift: boolean
}>()

const plate = computed(() => plates[props.composition.plate])
const top = computed(() => plate.value.groundTop ?? plate.value.horizonY)

const bandStyle = computed(() => ({ height: `${String((plate.value.height - top.value) * props.frame.scale)}px` }))

const imageStyle = computed(() => {
  const { x, width, height } = props.frame.plate
  return {
    transform: `translate(${String(x)}px, ${String(-top.value * props.frame.scale)}px)`,
    width: `${String(width)}px`,
    height: `${String(height)}px`,
  }
})

const sizes = computed(() => `${String(Math.ceil(props.frame.plate.width))}px`)
</script>

<template>
  <div class="scene-ground" :class="{ 'scene-ground--drift': drift }" :style="bandStyle" aria-hidden="true">
    <picture>
      <source type="image/avif" :srcset="plate.srcset.avif" :sizes="sizes" />
      <source type="image/webp" :srcset="plate.srcset.webp" :sizes="sizes" />
      <img class="scene-ground__plate" :src="plate.src" alt="" decoding="async" loading="lazy" :style="imageStyle" />
    </picture>
  </div>
</template>

<style scoped>
/* The band fades in from the page background above and back into it below, so it has no edges of its own. */
.scene-ground {
  position: relative;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 92%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 92%, transparent);
  pointer-events: none;
}

.scene-ground__plate {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  transform-origin: 0 0;
}

/*
 * Depth on touch screens without a pointer: the mountains come up a little
 * slower than the text while the band enters the viewport. Scroll-driven, so
 * it runs on the compositor; browsers without scroll timelines keep the band still.
 */
@supports (animation-timeline: view()) {
  .scene-ground--drift {
    view-timeline-name: --scene-ground;
  }

  .scene-ground--drift .scene-ground__plate {
    animation: scene-ground-rise linear both;
    animation-timeline: --scene-ground;
    animation-range: entry 0% entry 100%;
  }
}

@keyframes scene-ground-rise {
  from {
    translate: 0 28px;
  }

  to {
    translate: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scene-ground__plate {
    animation: none !important;
  }
}
</style>
