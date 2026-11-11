<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import CosmosIcon from './CosmosIcon.vue'

// Light filled action of DESIGN_SYSTEM §6. Navigation only: no network call
// may hang off it (SCREEN_SPEC MOT-01).
defineProps<{ to: RouteLocationRaw }>()
</script>

<template>
  <RouterLink class="primary-cta" :to="to">
    <span class="primary-cta__label"><slot /></span>
    <CosmosIcon class="primary-cta__arrow" name="arrow-right" />
  </RouterLink>
</template>

<style scoped>
.primary-cta {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8em;
  min-height: max(var(--cosmos-target-min), var(--cta-height, 58px));
  padding: 0 var(--cta-padding-right, var(--cta-padding-x, 24px)) 0 var(--cta-padding-x, 24px);
  min-width: var(--cta-width, auto);
  border-radius: var(--cosmos-radius-sm);
  background: var(--cosmos-text);
  color: var(--cosmos-ink);
  font-size: var(--cta-font, 15px);
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1;
  text-decoration: none;
  transition:
    transform var(--cosmos-dur-micro) var(--cosmos-ease-out),
    background-color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.primary-cta__arrow {
  width: 1.3em;
  height: 1.3em;
  transition: transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.primary-cta:active {
  transform: scale(0.97);
}

@media (hover: hover) and (pointer: fine) {
  .primary-cta:hover {
    background: #f6f2ea;
  }

  .primary-cta:hover .primary-cta__arrow {
    transform: translateX(3px);
  }
}
</style>
