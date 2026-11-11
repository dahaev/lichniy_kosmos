<script setup lang="ts">
import { computed } from 'vue'

import CosmosIcon from './CosmosIcon.vue'

// DESIGN_SYSTEM §6 `Field`: an underline on the sky, a clear label, the
// error under the field as text and icon, never colour alone. The control
// itself comes through the slot with the ids it must reference. A group of
// controls (day / month / year) is a fieldset with the label as legend.

const props = defineProps<{
  id: string
  label: string
  hint?: string | undefined
  error?: string | null | undefined
  group?: boolean
  /** The hint confirms how the input was understood (the date spelled out), not how to fill it. */
  confirmed?: boolean
}>()

const messageId = computed(() => `${props.id}-message`)
const invalid = computed(() => Boolean(props.error))
const message = computed(() => props.error ?? props.hint ?? null)
</script>

<template>
  <component :is="group ? 'fieldset' : 'div'" class="field" :class="{ 'field--invalid': invalid }">
    <component :is="group ? 'legend' : 'label'" class="field__label" :for="group ? undefined : id">{{ label }}</component>
    <div class="field__control">
      <slot :described-by="message ? messageId : undefined" :invalid="invalid" />
      <span class="field__line" aria-hidden="true" />
    </div>
    <p
      v-if="message"
      :id="messageId"
      :key="error ? `e:${error}` : 'hint'"
      class="field__message"
      :class="{ 'field__message--error': error, 'field__message--confirmed': !error && confirmed }"
    >
      <CosmosIcon v-if="error" class="field__message-icon" name="alert" />
      <CosmosIcon v-else-if="confirmed" class="field__message-icon field__message-icon--check" name="check" />
      <span>{{ message }}</span>
    </p>
  </component>
</template>

<style scoped>
.field {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.field__label {
  display: block;
  margin: 0 0 10px;
  padding: 0;
  color: #a3a7b0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: var(--cosmos-tracking-micro);
  line-height: 1;
  text-transform: uppercase;
}

.field__control {
  position: relative;
}

/* When focus or the on-screen keyboard scrolls the input into view, its label and message come along. */
.field__control :slotted(input) {
  scroll-margin-block: 32px 56px;
}

/* Drawn left to right as the step arrives; the focus ring stays on the control. */
.field__line {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: rgba(225, 218, 207, .32);
  transform-origin: 0 50%;
  animation: field-line-in 480ms var(--cosmos-ease-out) var(--field-line-delay, 260ms) both;
  transition:
    background-color var(--cosmos-dur-micro) var(--cosmos-ease-out),
    transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
  pointer-events: none;
}

/* The underline is the focus indicator of the field: gold and twice as thick. */
.field__control:focus-within .field__line {
  background: var(--cosmos-gold-light);
  transform: scaleY(2);
}

.field:focus-within .field__label {
  color: var(--cosmos-gold-light);
}

.field--invalid .field__line {
  background: var(--cosmos-danger);
}

.field__message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0 0;
  color: var(--cosmos-faint);
  font-size: 13px;
  line-height: 1.45;
  text-wrap: pretty;
}

.field__message--error {
  color: var(--cosmos-danger);
  animation: field-message-in var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.field__message-icon {
  margin-top: 1px;
  font-size: 16px;
}

.field__message--confirmed {
  align-items: center;
  gap: 10px;
  color: var(--cosmos-text);
  font-size: 14px;
}

.field__message-icon--check {
  margin-top: 0;
  color: var(--cosmos-gold-light);
  font-size: 18px;
}

@keyframes field-line-in {
  from {
    transform: scaleX(0);
  }
}

@keyframes field-message-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .field__line {
    animation: none;
  }

  .field__message--error {
    animation-name: field-message-fade;
  }

  @keyframes field-message-fade {
    from {
      opacity: 0;
    }
  }
}
</style>
