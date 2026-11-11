<script setup lang="ts">
import { useTemplateRef } from 'vue'

// One question of the intake, set like the hero title: a light sans line and
// a gold italic serif line (SCR-02 §0.4). Lines carry data-line so the
// step entrance can stagger them.

defineProps<{ line: string; accent: string; lead: string }>()

const heading = useTemplateRef<HTMLElement>('heading')

defineExpose({
  focus() {
    heading.value?.focus({ preventScroll: true })
  },
})
</script>

<template>
  <div class="intake-question">
    <h1 ref="heading" class="intake-question__title" tabindex="-1">
      <span class="intake-question__line" data-line style="--i: 0">{{ line }}</span>
      <span class="intake-question__accent" data-line style="--i: 1">{{ accent }}</span>
    </h1>
    <p class="intake-question__lead" data-line style="--i: 2">{{ lead }}</p>
    <div class="intake-question__body" data-line style="--i: 3">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.intake-question__title {
  margin: 0;
  color: #f6f4ef;
  font-size: clamp(34px, 9.2vw, 48px);
  font-weight: 300;
  letter-spacing: -0.025em;
  line-height: 1.02;
}

.intake-question__title:focus {
  outline: none;
}

.intake-question__line,
.intake-question__accent {
  display: block;
}

.intake-question__accent {
  color: var(--cosmos-gold-pale);
  font-family: var(--cosmos-font-serif);
  font-size: 1.078em;
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.intake-question__lead {
  max-width: 40ch;
  margin: 10px 0 0;
  color: var(--cosmos-muted);
  font-size: 15px;
  line-height: 1.6;
  text-wrap: pretty;
}

.intake-question__body {
  margin-top: 24px;
}

@media (min-width: 960px) and (min-height: 600px) and (min-aspect-ratio: 6/5) {
  .intake-question__title {
    font-size: clamp(44px, calc(64 * var(--scene-u, 1px)), 76px);
  }

  .intake-question__lead {
    margin-top: calc(16 * var(--scene-u, 1px));
    font-size: max(15px, calc(16 * var(--scene-u, 1px)));
  }

  .intake-question__body {
    margin-top: calc(40 * var(--scene-u, 1px));
  }
}
</style>
