<script setup lang="ts" generic="T extends string | number">
import { computed } from 'vue'

import CosmosIcon from '@/ui/CosmosIcon.vue'

// A labelled set of native radios drawn as quiet text options. Native
// inputs keep arrow-key navigation and form semantics for free. The
// segmented variant is the «Знаю время / Не знаю» switch: one gold mark
// slides under the chosen half (SCR-02 §2.3).

const props = defineProps<{
  name: string
  legend: string
  options: readonly { value: T; label: string }[]
  error?: string | null | undefined
  segmented?: boolean
}>()

const model = defineModel<T | null>({ required: true })

const messageId = computed(() => `${props.name}-message`)
const index = computed(() => props.options.findIndex((o) => o.value === model.value))
/** Nothing chosen yet: the mark waits under the first option instead of outside the control. */
const markAt = computed(() => Math.max(index.value, 0))
</script>

<template>
  <fieldset class="choice" :class="{ 'choice--segmented': segmented, 'choice--invalid': error }">
    <legend class="choice__legend">{{ legend }}</legend>
    <div class="choice__options" :style="{ '--n': options.length, '--at': markAt }">
      <label v-for="option in options" :key="String(option.value)" class="choice__option" :class="{ 'is-on': option.value === model }">
        <input
          v-model="model"
          class="choice__input"
          type="radio"
          :name="name"
          :value="option.value"
          :aria-invalid="error ? true : undefined"
          :aria-describedby="error ? messageId : undefined"
        />
        <span>{{ option.label }}</span>
      </label>
      <span v-if="segmented" class="choice__mark" :class="{ 'is-on': index >= 0 }" aria-hidden="true" />
    </div>
    <p v-if="error" :id="messageId" :key="error" class="choice__error">
      <CosmosIcon class="choice__error-icon" name="alert" />
      <span>{{ error }}</span>
    </p>
  </fieldset>
</template>

<style scoped>
.choice {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.choice__legend {
  margin: 0 0 10px;
  padding: 0;
  color: #a3a7b0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: var(--cosmos-tracking-micro);
  line-height: 1;
  text-transform: uppercase;
}

.choice__options {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.choice__option {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: var(--cosmos-target-min);
  padding: 0 16px;
  border: 1px solid var(--cosmos-line);
  border-radius: 999px;
  color: var(--cosmos-muted);
  font-size: 14px;
  line-height: 1.2;
  cursor: pointer;
  transition:
    color var(--cosmos-dur-micro) var(--cosmos-ease-out),
    border-color var(--cosmos-dur-micro) var(--cosmos-ease-out),
    background-color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.choice__option.is-on {
  border-color: rgba(227, 201, 148, .6);
  background: rgba(227, 201, 148, .1);
  color: var(--cosmos-text);
}

.choice__option:has(.choice__input:focus-visible) {
  outline: 2px solid var(--cosmos-focus);
  outline-offset: 3px;
}

.choice__option:active {
  transform: scale(0.97);
}

/* The radio stays in the accessibility tree and in tab order. */
.choice__input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.choice--invalid .choice__option {
  border-color: rgba(227, 161, 154, .5);
}

@media (hover: hover) and (pointer: fine) {
  .choice__option:hover {
    color: var(--cosmos-text);
  }
}

/* Segmented: two equal halves on one underline, the mark slides between them. */
.choice--segmented .choice__options {
  display: grid;
  grid-template-columns: repeat(var(--n), minmax(0, 1fr));
  gap: 0;
  max-width: 420px;
  border-bottom: 1px solid rgba(225, 218, 207, .32);
}

.choice--segmented .choice__option,
.choice--segmented .choice__option.is-on {
  justify-content: center;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: none;
  font-size: 16px;
}

.choice--segmented.choice--invalid .choice__options {
  border-bottom-color: var(--cosmos-danger);
}

.choice__mark {
  position: absolute;
  bottom: -1px;
  left: 0;
  width: calc(100% / var(--n));
  height: 2px;
  background: var(--cosmos-gold-light);
  opacity: 0;
  transform: translateX(calc(100% * var(--at)));
  transition:
    transform 240ms var(--cosmos-ease-in-out),
    opacity var(--cosmos-dur-micro) var(--cosmos-ease-out);
  pointer-events: none;
}

.choice__mark.is-on {
  opacity: 1;
}

.choice__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0 0;
  color: var(--cosmos-danger);
  font-size: 13px;
  line-height: 1.45;
  animation: choice-error-in var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.choice__error-icon {
  margin-top: 1px;
  font-size: 16px;
}

@keyframes choice-error-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .choice__mark {
    transition: opacity var(--cosmos-dur-micro) linear;
  }

  .choice__option:active {
    transform: none;
  }

  .choice__error {
    animation-name: choice-error-fade;
  }

  @keyframes choice-error-fade {
    from {
      opacity: 0;
    }
  }
}
</style>
