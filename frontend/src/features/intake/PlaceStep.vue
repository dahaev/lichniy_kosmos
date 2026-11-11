<script setup lang="ts">
import { useTemplateRef } from 'vue'

import CosmosIcon from '@/ui/CosmosIcon.vue'
import Field from '@/ui/Field.vue'

import CityCombobox from './CityCombobox.vue'
import { useIntakeDraft } from './draft'
import IntakeQuestion from './IntakeQuestion.vue'
import { placeLabel } from './placesApi'

defineProps<{ error: string | null }>()

const { draft } = useIntakeDraft()
const question = useTemplateRef<InstanceType<typeof IntakeQuestion>>('question')
const combobox = useTemplateRef<InstanceType<typeof CityCombobox>>('combobox')

defineExpose({
  focusHeading: () => question.value?.focus(),
  focusField: () => combobox.value?.focus(),
})
</script>

<template>
  <IntakeQuestion ref="question" line="Где началась" accent="твоя история?" lead="Город рождения задаёт координаты и часовой пояс — их мы возьмём из справочника.">
    <Field
      id="intake-place"
      label="Город рождения"
      :hint="draft.place.selected ? undefined : 'Начни вводить название и выбери город из списка.'"
      :error="error"
    >
      <template #default="{ describedBy, invalid }">
        <CityCombobox
          id="intake-place"
          ref="combobox"
          v-model:query="draft.place.query"
          v-model:selected="draft.place.selected"
          :described-by="describedBy"
          :invalid="invalid"
        />
      </template>
    </Field>
    <p v-if="draft.place.selected && !error" class="place-chosen">
      <CosmosIcon class="place-chosen__mark" name="check" />
      <span><span class="visually-hidden">Выбрано: </span>{{ placeLabel(draft.place.selected) }}</span>
    </p>
  </IntakeQuestion>
</template>

<style scoped>
.place-chosen {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0 0;
  color: var(--cosmos-text);
  font-size: 14px;
  line-height: 1.4;
}

.place-chosen__mark {
  color: var(--cosmos-gold-light);
  font-size: 18px;
}
</style>
