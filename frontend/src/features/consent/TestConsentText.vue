<script setup lang="ts">
// SCR-05 §0.5 п. 3: a stand-in for the consent wording, which is Q12 and is
// not invented here. It must not read as a real text. Dev builds only.
</script>

<template>
  <span class="consent-test-text">[Текст согласия появится после Q12]</span>
</template>

<style scoped>
.consent-test-text {
  color: var(--cosmos-muted);
  font-style: italic;
}
</style>
