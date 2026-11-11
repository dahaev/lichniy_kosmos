<script setup lang="ts">
import { motion } from 'motion-v'
import { useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'

import { routeFade } from '@/motion/presets'

import { useRouteFocus } from '../useRouteFocus'

// Neutral placeholder for screens that later slices build. Deliberately not
// a design: no hero composition, no final typography (see SCREEN_SPEC).

const route = useRoute()
const heading = useTemplateRef<HTMLElement>('heading')
useRouteFocus(heading)
</script>

<template>
  <motion.main id="main" class="stub" :initial="routeFade.initial" :animate="routeFade.animate" :exit="routeFade.exit">
    <p class="stub__screen">{{ route.meta.screen }}</p>
    <h1 ref="heading" class="stub__title" tabindex="-1">{{ route.meta.title }}</h1>
    <p class="stub__note">Экран-заглушка технического среза S0. Реализуется в срезе {{ route.meta.slice }}.</p>
  </motion.main>
</template>

<style scoped>
.stub {
  position: relative;
  z-index: var(--cosmos-z-content);
  min-height: 100dvh;
  max-width: var(--cosmos-max-content);
  margin: 0 auto;
  padding: calc(var(--cosmos-page-gutter) * 1.5) var(--cosmos-page-gutter);
}

.stub__screen {
  margin: 0;
  color: var(--cosmos-gold);
  font-size: 0.75rem;
  letter-spacing: var(--cosmos-tracking-micro);
  text-transform: uppercase;
}

.stub__title {
  margin: 0.5rem 0 1rem;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 300;
  line-height: 1.15;
}

.stub__title:focus {
  outline: none;
}

.stub__note {
  max-width: 40ch;
  margin: 0;
  color: var(--cosmos-muted);
}
</style>
