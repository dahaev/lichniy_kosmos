<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from 'vue'

import Field from '@/ui/Field.vue'

import ChoiceGroup from './ChoiceGroup.vue'
import { useIntakeDraft } from './draft'
import IntakeQuestion from './IntakeQuestion.vue'
import { accuracyBySource, normalizeTime, type TimeAccuracy, type TimeKind, type TimeSource } from './validation'

// SCREEN_SPEC §4 step 4. Unknown time clears the exact time and records
// source=unknown, accuracy=0. The explanation names what is lost without
// promising houses or the ascendant.

const props = defineProps<{ error: string | null }>()

const { draft } = useIntakeDraft()
const question = useTemplateRef<InstanceType<typeof IntakeQuestion>>('question')
const timeInput = useTemplateRef<HTMLInputElement>('timeInput')
const root = useTemplateRef<HTMLElement>('root')

const kinds = [
  { value: 'known', label: 'Знаю время' },
  { value: 'unknown', label: 'Не знаю' },
] as const satisfies readonly { value: TimeKind; label: string }[]

const sources = [
  { value: 'document', label: 'По документу' },
  { value: 'family', label: 'Со слов родных' },
  { value: 'approximate', label: 'Примерно' },
] as const satisfies readonly { value: TimeSource; label: string }[]

const accuracies = [
  { value: 0, label: 'До минуты' },
  { value: 15, label: '±15 мин' },
  { value: 30, label: '±30 мин' },
  { value: 60, label: '±1 час' },
] as const satisfies readonly { value: TimeAccuracy; label: string }[]

const kind = computed<TimeKind | null>({
  get: () => draft.time.kind,
  set(value) {
    draft.time.kind = value
    if (value === 'unknown') {
      Object.assign(draft.time, { hhmm: '', source: 'unknown', accuracy: 0, accuracyTouched: false })
    } else if (draft.time.source === 'unknown') {
      Object.assign(draft.time, { source: null, accuracy: null })
    }
  },
})

const source = computed<TimeSource | null>({
  get: () => (draft.time.source === 'unknown' ? null : draft.time.source),
  set(value) {
    draft.time.source = value
    if (value && value !== 'unknown' && !draft.time.accuracyTouched) draft.time.accuracy = accuracyBySource[value]
  },
})

const accuracy = computed<TimeAccuracy | null>({
  get: () => draft.time.accuracy,
  set(value) {
    draft.time.accuracy = value
    draft.time.accuracyTouched = true
  },
})

/** Which control the step error belongs to, in the order validateTime checks them. */
const errorAt = computed(() => {
  if (!props.error) return null
  if (draft.time.kind === null) return 'kind'
  if (normalizeTime(draft.time.hhmm) === null) return 'hhmm'
  return 'source'
})

function onTimeInput(event: Event) {
  draft.time.hhmm = (event.target as HTMLInputElement).value.replace(/[^\d:.,\s]/g, '').slice(0, 5)
}

function onTimeBlur() {
  const normalized = normalizeTime(draft.time.hhmm)
  if (normalized) draft.time.hhmm = normalized
}

function focusFirst(selector: string) {
  root.value?.querySelector<HTMLInputElement>(selector)?.focus({ preventScroll: true })
}

defineExpose({
  focusHeading: () => question.value?.focus(),
  focusField: () => {
    if (draft.time.kind === 'known' && !draft.time.hhmm) timeInput.value?.focus({ preventScroll: true })
    else focusFirst('input[name="intake-time-kind"]:checked, input[name="intake-time-kind"]')
  },
  async focusInvalid() {
    await nextTick()
    if (errorAt.value === 'hhmm') timeInput.value?.focus({ preventScroll: true })
    else if (errorAt.value === 'source') focusFirst('input[name="intake-time-source"]')
    else focusFirst('input[name="intake-time-kind"]')
  },
})
</script>

<template>
  <IntakeQuestion ref="question" line="Знаешь время" accent="рождения?" lead="Время уточняет карту. Если его нет в документах, так и отметь — разбор всё равно получится.">
    <div ref="root" class="time-step">
      <ChoiceGroup v-model="kind" name="intake-time-kind" legend="Время рождения" :options="kinds" :error="errorAt === 'kind' ? error : null" segmented />

      <div class="time-step__collapse time-step__known" :class="{ 'is-open': kind === 'known' }" :inert="kind !== 'known' || undefined">
        <div class="time-step__collapse-inner">
          <div class="time-step__known-body">
            <div class="time-step__row">
              <Field id="intake-time" class="time-step__time" label="Время по часам" hint="Например, 14:30" :error="errorAt === 'hhmm' ? error : null">
                <template #default="{ describedBy, invalid }">
                  <input
                    id="intake-time"
                    ref="timeInput"
                    class="intake-input time-step__input"
                    :value="draft.time.hhmm"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    enterkeyhint="next"
                    placeholder="14:30"
                    maxlength="5"
                    :aria-invalid="invalid || undefined"
                    :aria-describedby="describedBy"
                    @input="onTimeInput"
                    @blur="onTimeBlur"
                  />
                </template>
              </Field>
              <ChoiceGroup v-model="source" name="intake-time-source" legend="Откуда известно" :options="sources" :error="errorAt === 'source' ? error : null" />
            </div>
            <ChoiceGroup v-model="accuracy" name="intake-time-accuracy" legend="Точность" :options="accuracies" />
          </div>
        </div>
      </div>

      <div class="time-step__collapse time-step__explain" :class="{ 'is-open': kind === 'unknown' }" :aria-hidden="kind !== 'unknown' || undefined">
        <div class="time-step__collapse-inner">
          <p class="time-step__unknown">
            Без времени мы рассчитаем положение планет в знаках, но не будем строить дома и асцендент — их нельзя определить без часа рождения.
          </p>
        </div>
      </div>
    </div>
  </IntakeQuestion>
</template>

<style scoped>
/*
 * C30: the one height animation of the intake, instant under reduced motion.
 * The fields and the explanation trade places in the same 320 ms, so the
 * buttons below move once. Content fades in after the room opens and out
 * before it closes.
 */
.time-step__collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 280ms var(--cosmos-ease-in-out),
    opacity 120ms var(--cosmos-ease-out);
}

.time-step__collapse.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
  transition:
    grid-template-rows 320ms var(--cosmos-ease-in-out),
    opacity 200ms var(--cosmos-ease-out) 120ms;
}

.time-step__collapse-inner {
  min-height: 0;
  margin: 0 -8px;
  overflow: hidden;
}

/* The padding keeps focus rings inside the clip; on the inner box a 0fr row could not collapse it. */
.time-step__known-body {
  display: grid;
  gap: 24px;
  padding: 28px 8px 8px;
}

.time-step__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 24px 36px;
}

.time-step__time {
  flex: 0 0 132px;
}

.time-step__input {
  width: 100%;
}

.time-step__unknown {
  max-width: 46ch;
  margin: 0;
  padding-top: 20px;
  color: var(--cosmos-muted);
  font-size: 14px;
  line-height: 1.6;
}

@media (prefers-reduced-motion: reduce) {
  .time-step__collapse,
  .time-step__collapse.is-open {
    transition: none;
  }
}
</style>
