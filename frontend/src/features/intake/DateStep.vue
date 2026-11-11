<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import Field from '@/ui/Field.vue'

import { useIntakeDraft } from './draft'
import IntakeQuestion from './IntakeQuestion.vue'
import { formatDate, parsePastedDate, validateDate, type DateParts } from './validation'

// Decision 23: three numeric fields with the date spelled out under them,
// so day and month cannot be swapped unnoticed. Two digits move on to the
// next field; a pasted «12.03.1990» fills all three.

defineProps<{ error: string | null }>()

const { draft } = useIntakeDraft()
const question = useTemplateRef<InstanceType<typeof IntakeQuestion>>('question')

type Part = keyof DateParts

const inputs: Record<Part, HTMLInputElement | null> = { day: null, month: null, year: null }

const parts: { key: Part; label: string; placeholder: string; length: number }[] = [
  { key: 'day', label: 'День', placeholder: 'ДД', length: 2 },
  { key: 'month', label: 'Месяц', placeholder: 'ММ', length: 2 },
  { key: 'year', label: 'Год', placeholder: 'ГГГГ', length: 4 },
]

function inputOf(key: Part): HTMLInputElement | null {
  return inputs[key]
}

const echo = computed(() => {
  const result = validateDate(draft.date)
  return result.date ? formatDate(result.date) : undefined
})

function onInput(key: Part, length: number, event: Event) {
  const el = event.target as HTMLInputElement
  const digits = el.value.replace(/\D/g, '').slice(0, length)
  if (digits !== el.value) el.value = digits
  draft.date[key] = digits
  const index = parts.findIndex((p) => p.key === key)
  const next = parts[index + 1]
  if (next && digits.length === length && el.selectionStart === digits.length) inputOf(next.key)?.focus()
}

function onKeydown(key: Part, event: KeyboardEvent) {
  const el = event.target as HTMLInputElement
  if (event.key !== 'Backspace' || el.value !== '' || el.selectionStart !== 0) return
  const index = parts.findIndex((p) => p.key === key)
  const previous = parts[index - 1]
  if (!previous) return
  event.preventDefault()
  const target = inputOf(previous.key)
  target?.focus()
  target?.setSelectionRange(target.value.length, target.value.length)
}

function onPaste(event: ClipboardEvent) {
  const pasted = parsePastedDate(event.clipboardData?.getData('text') ?? '')
  if (!pasted) return
  event.preventDefault()
  Object.assign(draft.date, pasted)
  inputs.year?.focus()
}

defineExpose({
  focusHeading: () => question.value?.focus(),
  focusField: () => {
    const firstEmpty = parts.find((p) => draft.date[p.key] === '') ?? parts[0]
    if (firstEmpty) inputOf(firstEmpty.key)?.focus({ preventScroll: true })
  },
})
</script>

<template>
  <IntakeQuestion ref="question" line="Когда твой" accent="день рождения?" lead="По дате мы найдём, где стояли планеты в тот день.">
    <Field id="intake-date" label="Дата рождения" :hint="echo ?? 'День, месяц и год — например, 12 03 1990.'" :confirmed="Boolean(echo)" :error="error" group>
      <template #default="{ describedBy, invalid }">
        <div class="date-fields" @paste="onPaste">
          <template v-for="(part, i) in parts" :key="part.key">
            <span v-if="i > 0" class="date-fields__dot" aria-hidden="true">·</span>
            <input
              :id="`intake-date-${part.key}`"
              :ref="(el) => (inputs[part.key] = el as HTMLInputElement | null)"
              class="intake-input date-fields__input"
              :class="`date-fields__input--${part.key}`"
              :value="draft.date[part.key]"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              :autocomplete="`bday-${part.key}`"
              enterkeyhint="next"
              :maxlength="part.length"
              :placeholder="part.placeholder"
              :aria-label="part.label"
              :aria-invalid="invalid || undefined"
              :aria-describedby="describedBy"
              @input="onInput(part.key, part.length, $event)"
              @keydown="onKeydown(part.key, $event)"
            />
          </template>
        </div>
      </template>
    </Field>
  </IntakeQuestion>
</template>

<style scoped>
.date-fields {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.date-fields__input {
  flex: none;
  text-align: center;
}

.date-fields__input--day,
.date-fields__input--month {
  width: 2.6ch;
}

.date-fields__input--year {
  width: 4.4ch;
}

.date-fields__dot {
  color: rgba(225, 218, 207, .35);
  font-size: 28px;
}
</style>
