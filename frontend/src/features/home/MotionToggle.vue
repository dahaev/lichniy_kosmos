<script setup lang="ts">
import { useSceneStore } from '@/scene/sceneStore'
import CosmosIcon from '@/ui/CosmosIcon.vue'

// The reference's "Замедлись. Почувствуй." with its pause ring is the visible
// control that stops ambient scene motion (WCAG 2.2.2 Pause, Stop, Hide).
const scene = useSceneStore()
</script>

<template>
  <button class="motion-toggle" type="button" :aria-pressed="scene.motionPaused" @click="scene.toggleMotion()">
    <span class="motion-toggle__label">Замедлись. Почувствуй.<span class="visually-hidden"> Пауза фонового движения</span></span>
    <span class="motion-toggle__ring"><CosmosIcon :name="scene.motionPaused ? 'play' : 'pause'" /></span>
  </button>
</template>

<style scoped>
.motion-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--toggle-gap, 12px);
  min-height: var(--cosmos-target-min);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: #8f9195;
  font: inherit;
  font-size: var(--toggle-font, 11px);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.motion-toggle__ring {
  display: inline-grid;
  place-items: center;
  width: var(--toggle-ring, 37px);
  height: var(--toggle-ring, 37px);
  border: 1px solid rgba(225, 218, 207, .3);
  border-radius: 50%;
  color: #b9b6b0;
  font-size: calc(var(--toggle-ring, 37px) * 0.42);
  transition:
    border-color var(--cosmos-dur-micro) var(--cosmos-ease-out),
    transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.motion-toggle:active .motion-toggle__ring {
  transform: scale(0.94);
}

@media (hover: hover) and (pointer: fine) {
  .motion-toggle:hover {
    color: var(--cosmos-muted);
  }

  .motion-toggle:hover .motion-toggle__ring {
    border-color: rgba(225, 218, 207, .6);
  }
}
</style>
