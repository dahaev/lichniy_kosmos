<script lang="ts">
// Hairline icon set of the hero: one 24-unit grid, one stroke weight.
export type CosmosIconName = 'arrow-right' | 'arrow-left' | 'play' | 'pause' | 'sparkle' | 'sparkle-outline' | 'plus' | 'alert' | 'check'
</script>

<script setup lang="ts">
defineProps<{ name: CosmosIconName }>()
</script>

<template>
  <svg class="cosmos-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g v-if="name === 'arrow-right'" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12h19.5" />
      <path d="M16 6.5 21.5 12 16 17.5" />
    </g>
    <g v-else-if="name === 'arrow-left'" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 12H2.5" />
      <path d="M8 6.5 2.5 12 8 17.5" />
    </g>
    <g v-else-if="name === 'alert'" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round">
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 7v6.5" />
      <path d="M12 16.6v.1" stroke-width="1.75" />
    </g>
    <path v-else-if="name === 'check'" d="M4.5 12.5 9.5 17.5 19.5 7" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
    <path v-else-if="name === 'play'" d="M9 7.2v9.6l7.6-4.8z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" />
    <g v-else-if="name === 'pause'" fill="currentColor">
      <rect x="8.6" y="7.5" width="1.6" height="9" rx=".4" />
      <rect x="13.8" y="7.5" width="1.6" height="9" rx=".4" />
    </g>
    <path v-else-if="name === 'sparkle'" d="M12 1.5c.7 6 4.5 9.8 10.5 10.5-6 .7-9.8 4.5-10.5 10.5C11.3 16.5 7.5 12.7 1.5 12 7.5 11.3 11.3 7.5 12 1.5z" fill="currentColor" />
    <path
      v-else-if="name === 'sparkle-outline'"
      d="M12 1.5c.7 6 4.5 9.8 10.5 10.5-6 .7-9.8 4.5-10.5 10.5C11.3 16.5 7.5 12.7 1.5 12 7.5 11.3 11.3 7.5 12 1.5z"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      stroke-linejoin="round"
    />
    <path v-else-if="name === 'plus'" d="M12 2v20M2 12h20" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
  </svg>
</template>

<style scoped>
.cosmos-icon {
  display: inline-block;
  flex: none;
  width: 1em;
  height: 1em;
}
</style>
