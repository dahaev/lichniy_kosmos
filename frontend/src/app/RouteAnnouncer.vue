<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

// Announces the new screen title to assistive technology after in-app
// navigation; the first load is announced by the browser itself.

const route = useRoute()
const message = ref('')

watch(
  () => route.fullPath,
  () => {
    message.value = route.meta.title
  },
)
</script>

<template>
  <div class="visually-hidden" aria-live="polite" aria-atomic="true">{{ message }}</div>
</template>
