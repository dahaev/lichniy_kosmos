<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import CosmosIcon, { type CosmosIconName } from './CosmosIcon.vue'

// Quiet text action with a hairline ring icon (DESIGN_SYSTEM §6).
withDefaults(defineProps<{ to: RouteLocationRaw; icon?: CosmosIconName }>(), { icon: 'play' })
</script>

<template>
  <RouterLink class="secondary-cta" :to="to">
    <span class="secondary-cta__ring"><CosmosIcon :name="icon" /></span>
    <span class="secondary-cta__label"><slot /></span>
  </RouterLink>
</template>

<style scoped>
.secondary-cta {
  display: inline-flex;
  align-items: center;
  gap: var(--secondary-gap, 18px);
  min-height: var(--cosmos-target-min);
  color: #c0c4c9;
  font-size: var(--secondary-font, 14px);
  font-weight: 500;
  letter-spacing: 0.01em;
  text-decoration: none;
  transition: color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.secondary-cta__ring {
  display: inline-grid;
  place-items: center;
  width: var(--secondary-ring, 30px);
  height: var(--secondary-ring, 30px);
  border: 1px solid rgba(225, 218, 207, .38);
  border-radius: 50%;
  font-size: calc(var(--secondary-ring, 30px) * 0.5);
  transition:
    border-color var(--cosmos-dur-micro) var(--cosmos-ease-out),
    transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.secondary-cta:active .secondary-cta__ring {
  transform: scale(0.94);
}

@media (hover: hover) and (pointer: fine) {
  .secondary-cta:hover {
    color: var(--cosmos-text);
  }

  .secondary-cta:hover .secondary-cta__ring {
    border-color: rgba(225, 218, 207, .7);
  }
}
</style>
