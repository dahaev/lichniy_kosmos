<script setup lang="ts">
import { computed } from 'vue'

// DESIGN_SYSTEM §6 `ProgressStep`: «01 ━━ ── ── ── / 04», the count of the
// hero strip turned into the intake's progress. The picture is hidden from
// assistive technology, which reads the text status instead.

const props = defineProps<{ current: number; total: number }>()

const pad = (n: number) => String(n).padStart(2, '0')
const label = computed(() => `Шаг ${String(props.current)} из ${String(props.total)}`)
</script>

<template>
  <div class="progress-step">
    <p class="visually-hidden">{{ label }}</p>
    <div class="progress-step__picture" aria-hidden="true">
      <span class="progress-step__count">
        <Transition name="progress-step-roll">
          <span :key="current" class="progress-step__digit">{{ pad(current) }}</span>
        </Transition>
      </span>
      <span class="progress-step__track">
        <span v-for="n in total" :key="n" class="progress-step__segment" :class="{ 'is-done': n <= current }" />
      </span>
      <span class="progress-step__total"><span class="progress-step__slash">/</span> {{ pad(total) }}</span>
    </div>
  </div>
</template>

<style scoped>
.progress-step__picture {
  display: flex;
  align-items: center;
  gap: 16px;
  color: #969d9d;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
  line-height: 1;
}

/* One line tall: the old digit rolls up and out while the new one rises in. */
.progress-step__count {
  position: relative;
  display: inline-block;
  overflow: hidden;
  height: 1.2em;
  min-width: 2ch;
  color: var(--cosmos-text);
}

.progress-step__digit {
  display: block;
  line-height: 1.2em;
}

.progress-step-roll-enter-active,
.progress-step-roll-leave-active {
  transition:
    transform 300ms var(--cosmos-ease-out),
    opacity 300ms var(--cosmos-ease-out);
}

.progress-step-roll-leave-active {
  position: absolute;
  top: 0;
  left: 0;
}

.progress-step-roll-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.progress-step-roll-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.progress-step__track {
  display: inline-flex;
  gap: 6px;
}

.progress-step__segment {
  position: relative;
  width: 28px;
  height: 1px;
  overflow: hidden;
  background: rgba(225, 218, 207, .2);
}

.progress-step__segment::after {
  position: absolute;
  inset: 0;
  background: var(--cosmos-gold-pale);
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform 600ms var(--cosmos-ease-in-out);
  content: "";
}

.progress-step__segment.is-done::after {
  transform: scaleX(1);
}

.progress-step__slash {
  margin-right: 0.6em;
  color: #7c848c;
}

@media (prefers-reduced-motion: reduce) {
  .progress-step-roll-enter-active,
  .progress-step-roll-leave-active {
    transition: opacity 200ms linear;
  }

  .progress-step-roll-enter-from,
  .progress-step-roll-leave-to {
    transform: none;
  }

  .progress-step__segment::after {
    transition: none;
  }
}
</style>
