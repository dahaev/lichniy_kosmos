<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef } from 'vue'

import type { PlaceChoice } from './draft'
import { PLACE_QUERY_MIN, searchPlaces, type Place } from './placesApi'

// ARIA 1.2 combobox, list autocomplete with automatic selection (WAI-ARIA
// APG): the first match is active, Enter picks it, arrows move, Escape
// closes. Searches are debounced, older ones aborted and late answers
// dropped, so the list always belongs to the text in the field.

const props = defineProps<{
  id: string
  describedBy: string | undefined
  invalid: boolean
  /** Injected in tests; the real client otherwise. */
  search?: (query: string, signal: AbortSignal) => Promise<Place[]>
}>()

const query = defineModel<string>('query', { required: true })
const selected = defineModel<PlaceChoice | null>('selected', { required: true })

/** What the popup shows; a search in flight keeps the previous list until it answers. */
type SearchStatus = 'idle' | 'ready' | 'empty' | 'error'

const SEARCH_DELAY_MS = 250
const LOADING_DELAY_MS = 300

const input = useTemplateRef<HTMLInputElement>('input')
const listbox = useTemplateRef<HTMLUListElement>('listbox')
const results = shallowRef<Place[]>([])
const status = ref<SearchStatus>('idle')
const pending = ref(false)
const slow = ref(false)
const open = ref(false)
const active = ref(-1)

let debounce: ReturnType<typeof setTimeout> | undefined
let loadingTimer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | null = null
let sequence = 0

const listboxId = computed(() => `${props.id}-listbox`)
const optionId = (index: number) => `${props.id}-option-${String(index)}`
const activeId = computed(() => (open.value && active.value >= 0 ? optionId(active.value) : undefined))
const expanded = computed(() => open.value && status.value === 'ready')
const showPopup = computed(() => open.value && (status.value !== 'idle' || slow.value))

/** Announced politely; the visible list carries the same information. */
const announcement = computed(() => {
  if (!open.value) return ''
  if (slow.value) return 'Ищем…'
  if (pending.value) return ''
  if (status.value === 'ready') return `Найдено: ${String(results.value.length)}. Стрелки — выбор, Enter — подтвердить.`
  if (status.value === 'empty') return 'Ничего не нашли.'
  if (status.value === 'error') return 'Не удалось загрузить список.'
  return ''
})

function cancelSearch() {
  clearTimeout(debounce)
  clearTimeout(loadingTimer)
  controller?.abort()
  controller = null
  pending.value = false
  slow.value = false
}

async function run(text: string) {
  cancelSearch()
  const current = ++sequence
  controller = new AbortController()
  const { signal } = controller
  pending.value = true
  open.value = true
  loadingTimer = setTimeout(() => {
    if (current === sequence) slow.value = true
  }, LOADING_DELAY_MS)
  try {
    const found = await (props.search ?? searchPlaces)(text, signal)
    if (current !== sequence) return
    results.value = found
    status.value = found.length ? 'ready' : 'empty'
    active.value = found.length ? 0 : -1
  } catch {
    if (current !== sequence || signal.aborted) return
    results.value = []
    status.value = 'error'
    active.value = -1
  } finally {
    if (current === sequence) {
      clearTimeout(loadingTimer)
      pending.value = false
      slow.value = false
    }
  }
}

function onInput(event: Event) {
  const text = (event.target as HTMLInputElement).value
  query.value = text
  if (selected.value && text !== selected.value.name) selected.value = null
  cancelSearch()
  sequence++
  if (text.trim().length < PLACE_QUERY_MIN) {
    results.value = []
    status.value = 'idle'
    open.value = false
    return
  }
  pending.value = true
  debounce = setTimeout(() => void run(text.trim()), SEARCH_DELAY_MS)
}

function choose(place: Place) {
  cancelSearch()
  const choice: PlaceChoice = { id: place.id, name: place.name, country: place.country, ...(place.region ? { region: place.region } : {}) }
  selected.value = choice
  query.value = place.name
  open.value = false
  status.value = 'idle'
  results.value = []
  input.value?.focus()
}

async function move(delta: number) {
  if (pending.value || status.value !== 'ready' || results.value.length === 0) return
  if (!open.value) {
    open.value = true
    return
  }
  const n = results.value.length
  active.value = (active.value + delta + n) % n
  await nextTick()
  listbox.value?.querySelector<HTMLElement>(`#${optionId(active.value)}`)?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      void move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      void move(-1)
      break
    case 'Enter': {
      // Picking a city never submits the step in the same keystroke, and a
      // list that does not match the text yet cannot be picked from.
      if (pending.value) {
        event.preventDefault()
        break
      }
      const place = expanded.value ? results.value[active.value] : undefined
      if (place) {
        event.preventDefault()
        choose(place)
      }
      break
    }
    case 'Escape':
      if (open.value) {
        event.preventDefault()
        open.value = false
      }
      break
  }
}

function onBlur(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && listbox.value?.parentElement?.contains(next)) return
  open.value = false
}

function onFocus() {
  if (status.value === 'ready' || status.value === 'empty' || status.value === 'error') open.value = true
}

function retry() {
  const text = query.value.trim()
  if (text.length >= PLACE_QUERY_MIN) void run(text)
  input.value?.focus()
}

onBeforeUnmount(cancelSearch)

defineExpose({
  focus: () => input.value?.focus({ preventScroll: true }),
})
</script>

<template>
  <div class="city">
    <input
      :id="id"
      ref="input"
      class="intake-input"
      :value="query"
      type="text"
      role="combobox"
      autocomplete="off"
      autocapitalize="words"
      spellcheck="false"
      enterkeyhint="next"
      aria-autocomplete="list"
      :aria-expanded="expanded"
      :aria-controls="listboxId"
      :aria-activedescendant="activeId"
      :aria-invalid="invalid || undefined"
      :aria-describedby="describedBy"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
      @focus="onFocus"
    />
    <span class="city__progress" :class="{ 'is-on': slow }" aria-hidden="true" />

    <Transition name="city-popup">
      <div v-show="showPopup" class="city__popup">
        <ul v-show="status === 'ready'" :id="listboxId" ref="listbox" class="city__list" role="listbox" aria-label="Города">
          <li
            v-for="(place, i) in results"
            :id="optionId(i)"
            :key="place.id"
            class="city__option"
            :class="{ 'is-active': i === active }"
            role="option"
            :aria-selected="i === active"
            @pointerdown.prevent
            @click="choose(place)"
            @pointermove="active = i"
          >
            <span class="city__name">{{ place.name }}</span>
            <span class="city__where">{{ [place.region, place.country].filter(Boolean).join(' · ') }}</span>
          </li>
        </ul>
        <p v-if="slow && status !== 'ready'" class="city__note">Ищем…</p>
        <p v-else-if="status === 'empty'" class="city__note">Ничего не нашли. Проверь написание или попробуй ближайший крупный город.</p>
        <div v-else-if="status === 'error'" class="city__note city__note--error">
          <span>Не удалось загрузить список.</span>
          <button class="city__retry" type="button" @click="retry">Повторить</button>
        </div>
      </div>
    </Transition>

    <p class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.city {
  position: relative;
}

/* Brought into view with room for the first suggestions above the on-screen keyboard. */
.city .intake-input {
  scroll-margin-block: 32px 168px;
}

/* «Ищем…» after 300 ms: a thin running light on the underline, not a spinner. */
.city__progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  transition: opacity var(--cosmos-dur-micro) var(--cosmos-ease-out);
  pointer-events: none;
}

.city__progress.is-on {
  opacity: 1;
}

.city__progress::after {
  position: absolute;
  inset: 0;
  width: 30%;
  background: linear-gradient(to right, transparent, var(--cosmos-gold-light), transparent);
  content: "";
}

.city__progress.is-on::after {
  animation: city-progress 1100ms var(--cosmos-ease-in-out) infinite;
}

@keyframes city-progress {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(340%);
  }
}

.city__popup {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  left: 0;
  z-index: var(--cosmos-z-overlay);
  overflow: hidden;
  border: 1px solid var(--cosmos-line);
  border-radius: var(--cosmos-radius-md);
  /* Opaque: the cream «Далее» right under it would ghost through any alpha. */
  background: rgb(13, 25, 37);
  box-shadow: 0 18px 40px rgba(0, 0, 0, .45);
}

.city__list {
  max-height: min(320px, 42vh);
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
}

.city__option {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-height: var(--cosmos-target-min);
  padding: 8px 12px;
  border-radius: var(--cosmos-radius-sm);
  cursor: pointer;
}

.city__option.is-active {
  background: rgba(227, 201, 148, .12);
}

.city__name {
  color: var(--cosmos-text);
  font-size: 16px;
  line-height: 1.3;
}

.city__where {
  color: var(--cosmos-faint);
  font-size: 13px;
  line-height: 1.3;
}

/* The gold tint of the active row drops faint text below 4.5:1. */
.city__option.is-active .city__where {
  color: var(--cosmos-muted);
}

.city__note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin: 0;
  padding: 14px 18px;
  color: var(--cosmos-muted);
  font-size: 14px;
  line-height: 1.5;
}

.city__retry {
  min-height: var(--cosmos-target-min);
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--cosmos-gold-light);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 4px;
  cursor: pointer;
}

.city-popup-enter-active {
  transition:
    opacity var(--cosmos-dur-micro) var(--cosmos-ease-out),
    transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.city-popup-leave-active {
  transition: opacity 120ms var(--cosmos-ease-out);
}

.city-popup-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.city-popup-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .city-popup-enter-from {
    transform: none;
  }

  .city__progress::after,
  .city__progress.is-on::after {
    animation: none;
    width: 100%;
    opacity: .6;
  }
}
</style>
