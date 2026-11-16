<script setup lang="ts">
// SCR-05 §0.5 п. 3: the banner of the explicit test mode. Loaded only through
// `import.meta.env.DEV` in ConsentView, so no production bundle contains it.
// The wording is a proposal, not legal text.
</script>

<template>
  <p class="consent-test-banner" data-test-mode>Тестовый режим. Заказ создаётся на моке, юридический текст не утверждён.</p>
</template>

<style scoped>
.consent-test-banner {
  max-width: 44ch;
  margin: 0 0 14px;
  color: var(--cosmos-gold-light);
  font-size: 15px;
  line-height: 1.4;
  text-wrap: balance;
}
</style>
