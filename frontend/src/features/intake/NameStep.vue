<script setup lang="ts">
import { useTemplateRef } from 'vue'

import Field from '@/ui/Field.vue'

import { useIntakeDraft } from './draft'
import IntakeQuestion from './IntakeQuestion.vue'
import { NAME_MAX } from './validation'

defineProps<{ error: string | null }>()

const { draft } = useIntakeDraft()
const question = useTemplateRef<InstanceType<typeof IntakeQuestion>>('question')
const input = useTemplateRef<HTMLInputElement>('input')

defineExpose({
  focusHeading: () => question.value?.focus(),
  focusField: () => input.value?.focus({ preventScroll: true }),
})
</script>

<template>
  <IntakeQuestion ref="question" line="Как тебя" accent="зовут?" lead="Этим именем мы подпишем твою карту.">
    <Field id="intake-name" label="Имя" hint="Ответы хранятся только в этой вкладке и исчезнут, когда ты её закроешь." :error="error">
      <template #default="{ describedBy, invalid }">
        <input
          id="intake-name"
          ref="input"
          v-model="draft.name"
          class="intake-input"
          type="text"
          name="given-name"
          autocomplete="given-name"
          autocapitalize="words"
          enterkeyhint="next"
          spellcheck="false"
          :maxlength="NAME_MAX * 2"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedBy"
        />
      </template>
    </Field>
  </IntakeQuestion>
</template>
