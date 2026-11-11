<script setup lang="ts">
import { AnimatePresence, motion, useReducedMotion } from 'motion-v'
import { computed, nextTick, onMounted, reactive, ref, watch, type Component, type ComponentPublicInstance } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { isFirstNavigation } from '@/app/router'
import MotionToggle from '@/features/home/MotionToggle.vue'
import { intakeExit, stepBlockExit, type StepDirection } from '@/motion/presets'
import { useSceneStore } from '@/scene/sceneStore'
import CosmosIcon from '@/ui/CosmosIcon.vue'
import PrimaryCTA from '@/ui/PrimaryCTA.vue'
import ProgressStep from '@/ui/ProgressStep.vue'

import DateStep from './DateStep.vue'
import { stepError, useIntakeDraft } from './draft'
import { INTAKE_ROUTE } from './guard'
import NameStep from './NameStep.vue'
import PlaceStep from './PlaceStep.vue'
import { intakeSteps, nextStep, parseStep, previousStep, stepIndex, stepScene, type IntakeStep } from './steps'
import TimeStep from './TimeStep.vue'

// SCR-02, slice V1.2. The steps share one route (/create?step=); the
// scene frame of each step is chosen by App from the same query, so the
// camera and the copy change on the same click (M03, SCR-02 §2.3).
// The text column owns no background: the sky stays CosmosCanvas'.

interface StepHandle {
  focusHeading: () => void
  focusField: () => void
  focusInvalid?: () => Promise<void> | void
}

const route = useRoute()
const router = useRouter()
const { draft } = useIntakeDraft()
const scene = useSceneStore()
const reducedMotion = useReducedMotion()

const components: Record<IntakeStep, Component> = { name: NameStep, date: DateStep, place: PlaceStep, time: TimeStep }

const step = computed<IntakeStep>(() => parseStep(route.query.step) ?? draft.step)
const direction = ref<StepDirection>(1)
const attempted = reactive(new Set<IntakeStep>())

const firstLoad = isFirstNavigation(router)
/** Lines of the first block rise out of the scene; later blocks slide in along the direction. */
const arrived = ref(false)

const handles = new Map<IntakeStep, StepHandle>()
const blocks = new Map<IntakeStep, HTMLElement>()

type RefCallback = (ref: Element | ComponentPublicInstance | null) => void

// One callback per step, created at render with its key: a leaving block
// unmounts after the step has changed and must clear its own entry, not the
// entry of the step that replaced it.
const handleRefs = new Map<IntakeStep, RefCallback>()
const blockRefs = new Map<IntakeStep, RefCallback>()

function handleRef(key: IntakeStep): RefCallback {
  let callback = handleRefs.get(key)
  if (!callback) {
    callback = (instance) => {
      if (instance) handles.set(key, instance as unknown as StepHandle)
      else handles.delete(key)
    }
    handleRefs.set(key, callback)
  }
  return callback
}

function blockRef(key: IntakeStep): RefCallback {
  let callback = blockRefs.get(key)
  if (!callback) {
    callback = (ref) => {
      const el = ref && !(ref instanceof Element) ? (ref.$el as unknown) : ref
      if (el instanceof HTMLElement) blocks.set(key, el)
      else blocks.delete(key)
    }
    blockRefs.set(key, callback)
  }
  return callback
}

function errorFor(key: IntakeStep): string | null {
  return attempted.has(key) ? stepError(draft, key) : null
}

/** Decision 25: touch screens land on the question, so the keyboard does not cover the flight. */
function focusEntry(key: IntakeStep) {
  const handle = handles.get(key)
  if (!handle) return
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch || (firstLoad && !arrived.value)) handle.focusHeading()
  else handle.focusField()
}

// Synchronous: the direction and the inert old block must be set before
// the keyed block re-renders, and focus moves on the same click (§2.3).
watch(
  step,
  (next, previous) => {
    direction.value = stepIndex(next) >= stepIndex(previous) ? 1 : -1
    blocks.get(previous)?.setAttribute('inert', '')
    arrived.value = true
    draft.step = next
  },
  { flush: 'sync' },
)

watch(step, async (next) => {
  await nextTick()
  focusEntry(next)
})

/**
 * Lowest point of the planet over all four frames: on phones the question
 * starts below it, and the column does not shift from step to step.
 */
const clearY = computed(() => Math.max(0, ...intakeSteps.map((s) => {
  const frame = scene.frameFor(stepScene(s))
  return frame ? frame.planet.y + frame.planet.r : 0
})))

const stepEntrance = computed(() => (arrived.value ? 'step' : 'arrive'))
const blockExit = computed(() => (reducedMotion.value ? { opacity: 0, transition: { duration: 0.12 } } : stepBlockExit))

const isLast = computed(() => nextStep(step.value) === null)

function go(target: { step: IntakeStep } | '/' | '/create/review') {
  const location = typeof target === 'string' ? target : { name: INTAKE_ROUTE, query: { step: target.step } }
  // Back to where the visitor came from keeps the browser history linear.
  const back = router.options.history.state.back
  if (back && back === router.resolve(location).fullPath) router.back()
  else void router.push(location)
}

async function submit() {
  const current = step.value
  if (stepError(draft, current) !== null) {
    attempted.add(current)
    const handle = handles.get(current)
    if (handle?.focusInvalid) await handle.focusInvalid()
    else handle?.focusField()
    return
  }
  const next = nextStep(current)
  if (next) go({ step: next })
  else go('/create/review')
}

function back() {
  const previous = previousStep(step.value)
  go(previous ? { step: previous } : '/')
}

function onKeydown(event: KeyboardEvent) {
  // IME composition confirms a word with Enter; that is not «Далее».
  if (event.key === 'Enter' && event.isComposing) event.preventDefault()
}

onMounted(async () => {
  window.scrollTo({ top: 0 })
  draft.step = step.value
  await nextTick()
  focusEntry(step.value)
})
</script>

<template>
  <motion.main
    id="main"
    class="intake"
    :class="{ 'intake--reload': firstLoad }"
    :initial="false"
    :animate="{ opacity: 1 }"
    :exit="intakeExit"
    :data-step="step"
    :style="{ '--intake-clear-y': `${clearY}px` }"
  >
    <header class="intake__top">
      <RouterLink class="intake__home" to="/">
        <CosmosIcon class="intake__home-icon" name="arrow-left" />
        <span>На главную</span>
      </RouterLink>
    </header>

    <div class="intake__column">
      <ProgressStep class="intake__progress" data-line style="--i: 0" :current="stepIndex(step) + 1" :total="intakeSteps.length" />

      <form class="intake__form" novalidate @submit.prevent="submit" @keydown="onKeydown">
        <div class="intake__steps">
          <AnimatePresence mode="popLayout" :custom="direction" :initial="false">
            <motion.section
              :key="step"
              :ref="blockRef(step)"
              class="intake__step"
              :data-entrance="stepEntrance"
              :style="{ '--dir': direction }"
              :variants="{ exit: blockExit }"
              :animate="{ opacity: 1, x: 0, filter: 'blur(0px)' }"
              exit="exit"
            >
              <component :is="components[step]" :ref="handleRef(step)" :error="errorFor(step)" />
            </motion.section>
          </AnimatePresence>
        </div>

        <div class="intake__actions" data-line style="--i: 5">
          <PrimaryCTA class="intake__next">{{ isLast ? 'Проверить данные' : 'Далее' }}</PrimaryCTA>
          <button class="intake__back" type="button" @click="back">
            <CosmosIcon class="intake__back-icon" name="arrow-left" />
            <span>Назад</span>
          </button>
        </div>
      </form>
    </div>

    <footer class="intake__foot" data-line style="--i: 6">
      <MotionToggle class="intake__toggle" />
    </footer>
  </motion.main>
</template>

<style scoped>
.intake {
  --u: var(--scene-u, 1px);
  position: relative;
  z-index: var(--cosmos-z-content);
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  padding: 0 var(--cosmos-page-gutter);
  overflow-x: clip;
}

.intake__top {
  display: flex;
  align-items: center;
  min-height: 64px;
}

.intake__home,
.intake__back {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: var(--cosmos-target-min);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: #b9bfc5;
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.02em;
  text-decoration: none;
  cursor: pointer;
  transition: color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.intake__home-icon,
.intake__back-icon {
  font-size: 18px;
  transition: transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .intake__home:hover,
  .intake__back:hover {
    color: var(--cosmos-text);
  }

  .intake__home:hover .intake__home-icon,
  .intake__back:hover .intake__back-icon {
    transform: translateX(-3px);
  }
}

/*
 * Phones: the question starts near a fifth of the height, the keyboard
 * takes the lower half (SCR-02 §0.4), and never under the planet.
 */
.intake__column {
  width: 100%;
  max-width: 560px;
  padding-top: max(12px, calc(20svh - 64px), calc(var(--intake-clear-y, 0px) - 72px));
}

/*
 * Landscape windows too short or narrow for the reference layout stack the
 * column over the planet: a scrim from the left keeps the copy readable.
 */
@media (min-aspect-ratio: 6/5) and (max-width: 959px), (min-aspect-ratio: 6/5) and (max-height: 599px) {
  .intake::before {
    position: fixed;
    inset: 0;
    z-index: -1;
    background: linear-gradient(to right, rgba(7, 17, 29, .88), rgba(7, 17, 29, .7) 55%, rgba(7, 17, 29, 0));
    content: "";
    pointer-events: none;
  }

  .intake__column {
    padding-top: 12px;
  }
}

.intake__progress {
  margin-bottom: 16px;
}

/*
 * The step block and the actions are both stacking contexts (motion's inline
 * transform and filter, the filled data-line entrance). Explicit layers: a
 * taller step leaving in popLayout (absolute, auto) < the actions < the live
 * step, so a popup like the city suggestions is never under the buttons and
 * the leaving step never over them.
 */
.intake__steps {
  position: relative;
}

.intake__step:not([inert]) {
  position: relative;
  z-index: 2;
}

.intake__actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 28px;
  margin-top: 24px;
}

.intake__next {
  --cta-width: min(100%, 220px);
}

.intake__foot {
  display: flex;
  align-items: center;
  margin-top: auto;
  padding: 40px 0 max(20px, env(safe-area-inset-bottom));
}

/* Reference layout: the column sits on the hero's text line, the planet keeps the right. */
@media (min-width: 960px) and (min-height: 600px) and (min-aspect-ratio: 6/5) {
  .intake {
    padding: 0 calc(73 * var(--u)) 0 calc(74.5 * var(--u));
  }

  .intake__top {
    min-height: calc(110 * var(--u));
  }

  .intake__column {
    max-width: min(560px, calc(560 * var(--u)));
    padding-top: calc(48 * var(--u));
  }

  .intake__progress {
    margin-bottom: calc(34 * var(--u));
  }

  .intake__actions {
    margin-top: calc(40 * var(--u));
  }

  .intake__next {
    --cta-width: calc(220 * var(--u));
    --cta-height: calc(58 * var(--u));
    --cta-padding-x: calc(24.5 * var(--u));
    --cta-padding-right: calc(21 * var(--u));
    --cta-font: max(14px, calc(15 * var(--u)));
  }

  .intake__foot {
    justify-content: flex-end;
    min-height: calc(110 * var(--u));
    padding: 32px 0 24px;
  }

  .intake__toggle {
    --toggle-ring: calc(37 * var(--u));
    --toggle-gap: calc(14 * var(--u));
    --toggle-font: max(11px, calc(11.5 * var(--u)));
  }
}
</style>

<style>
/* Shared control face of the intake: large light text on the underline of Field. */
.intake-input {
  display: block;
  width: 100%;
  min-height: 52px;
  margin: 0;
  padding: 6px 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--cosmos-text);
  font: inherit;
  font-size: 24px;
  font-weight: 300;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

/* ≥4.5:1 on the sky: in the date fields the placeholder is the only cue for each part. */
.intake-input::placeholder {
  color: var(--cosmos-faint);
}

/* Focus is shown by the Field underline (gold, doubled) and the gold label. */
.intake-input:focus {
  outline: none;
}

@media (min-width: 960px) {
  .intake-input {
    font-size: 28px;
  }
}

/*
 * Entrances (SCR-02 §2.2–2.3). The first block rises out of the scene the
 * way the hero copy does; later blocks slide in along the direction of
 * travel while the old one leaves (motion-v exit). Input works at once:
 * only opacity and transform move, nothing waits for the animation.
 */
.intake [data-line] {
  animation: intake-rise var(--intake-enter, 420ms) var(--cosmos-ease-out) both;
  animation-delay: calc(var(--intake-base, 20ms) + var(--i, 0) * var(--intake-stagger, 45ms));
}

.intake--reload {
  --intake-enter: 600ms;
  --intake-stagger: 50ms;
  --intake-base: 60ms;
}

.intake__step[data-entrance] [data-line] {
  --intake-index: calc(var(--i, 0) + 1);
  animation-delay: calc(var(--intake-base, 20ms) + var(--intake-index) * var(--intake-stagger, 45ms));
}

.intake__step[data-entrance='step'] [data-line] {
  animation-name: intake-slide;
  animation-duration: var(--cosmos-dur-step-enter);
  animation-delay: calc(80ms + var(--i, 0) * 45ms);
}

@keyframes intake-rise {
  from {
    opacity: 0;
    filter: blur(6px);
    transform: translateY(12px);
  }
}

@keyframes intake-slide {
  from {
    opacity: 0;
    filter: blur(2px);
    transform: translateX(calc(20px * var(--dir, 1)));
  }
}

@media (prefers-reduced-motion: reduce) {
  .intake [data-line],
  .intake__step[data-entrance] [data-line] {
    animation: intake-fade var(--cosmos-dur-step-enter) linear both;
    animation-delay: 0ms;
  }

  @keyframes intake-fade {
    from {
      opacity: 0;
    }
  }
}
</style>
