<template>
  <a class="skip-link" href="#main">Перейти к содержанию</a>
</template>

<style scoped>
.skip-link {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  z-index: var(--cosmos-z-skip-link);
  padding: 0.75rem 1rem;
  border-radius: var(--cosmos-radius-sm);
  background: var(--cosmos-text);
  color: var(--cosmos-bg);
  transform: translateY(-200%);
  transition: transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.skip-link:focus-visible {
  transform: translateY(0);
}
</style>
