<script setup lang="ts">
import { motion } from 'motion-v'
import { useTemplateRef } from 'vue'
import { RouterLink } from 'vue-router'

import { routeFade } from '@/motion/presets'

import { useRouteFocus } from '../useRouteFocus'

const heading = useTemplateRef<HTMLElement>('heading')
useRouteFocus(heading)
</script>

<template>
  <motion.main id="main" class="not-found" :initial="routeFade.initial" :animate="routeFade.animate" :exit="routeFade.exit">
    <h1 ref="heading" class="not-found__title" tabindex="-1">Страница не найдена</h1>
    <p class="not-found__text">Такой страницы нет. Возможно, ссылка устарела.</p>
    <RouterLink class="not-found__link" to="/">На главную</RouterLink>
  </motion.main>
</template>

<style scoped>
.not-found {
  position: relative;
  z-index: var(--cosmos-z-content);
  min-height: 100dvh;
  max-width: var(--cosmos-max-content);
  margin: 0 auto;
  padding: calc(var(--cosmos-page-gutter) * 1.5) var(--cosmos-page-gutter);
}

.not-found__title {
  margin: 0 0 1rem;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 300;
}

.not-found__title:focus {
  outline: none;
}

.not-found__text {
  margin: 0 0 1.5rem;
  color: var(--cosmos-muted);
}

.not-found__link {
  display: inline-flex;
  align-items: center;
  min-height: var(--cosmos-target-min);
  color: var(--cosmos-gold-light);
}
</style>
