<script setup lang="ts">
import { motion } from 'motion-v'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { ApiProblem } from '@/api/problem'
import { isFirstNavigation } from '@/app/router'
import MotionToggle from '@/features/home/MotionToggle.vue'
import { intakeExit } from '@/motion/presets'
import { useSceneStore } from '@/scene/sceneStore'
import CosmosIcon from '@/ui/CosmosIcon.vue'
import PrimaryCTA from '@/ui/PrimaryCTA.vue'
import ProgressStep from '@/ui/ProgressStep.vue'

import { useIntakeDraft } from './draft'
import { INTAKE_ROUTE } from './guard'
import { blockNames, checkFailure, invalidSteps, requestProfileCheck, reviewItems, toProfile, type ProfileCheck } from './review'
import { intakeSteps, REVIEW_RETURN, stepScene, type IntakeStep } from './steps'

// SCR-03, slice V2: the four answers on the underlines they were typed on,
// checked by the server on every entry (Р5). The scene stays in the frame
// of step 04; the column keeps the intake's line so nothing jumps.

type CheckState =
  | { status: 'checking' }
  | { status: 'ok'; result: ProfileCheck }
  | { status: 'invalid'; errors: Partial<Record<IntakeStep, string>> }
  | { status: 'failed'; message: string }

/** A quick answer changes nothing on screen; only a slow one shows «Сверяем данные…». */
const SLOW_MS = 300

const router = useRouter()
const { draft } = useIntakeDraft()
const scene = useSceneStore()
const firstLoad = isFirstNavigation(router)

const heading = useTemplateRef<HTMLElement>('heading')
const statusBox = useTemplateRef<HTMLElement>('statusBox')
const retryButton = useTemplateRef<HTMLButtonElement>('retryButton')
const cta = useTemplateRef<InstanceType<typeof PrimaryCTA>>('cta')

const state = ref<CheckState>({ status: 'checking' })
const slow = ref(false)
/** After a failed check the retry button stays in place until a check succeeds. */
const retrying = ref(false)

const profile = computed(() => toProfile(draft))

const items = computed(() => {
  const checked = state.value.status === 'ok' ? state.value.result : null
  const source = checked?.profile ?? profile.value
  const place = checked?.place ?? draft.place.selected
  return source && place ? reviewItems(source, place) : []
})

const errors = computed(() => (state.value.status === 'invalid' ? state.value.errors : {}))
const ready = computed(() => state.value.status === 'ok')
const checking = computed(() => state.value.status === 'checking')
const dimmed = computed(() => (checking.value && slow.value) || state.value.status === 'invalid' || state.value.status === 'failed')
const showRetry = computed(() => state.value.status === 'failed' || (checking.value && retrying.value))

/** Same line as the steps: the lowest point of the planet over the four frames (IntakeView). */
const clearY = computed(() => Math.max(0, ...intakeSteps.map((s) => {
  const frame = scene.frameFor(stepScene(s))
  return frame ? frame.planet.y + frame.planet.r : 0
})))

/** «Изменить» and «Назад» leave to the right, «Продолжить» to the left (SCR-03 §2). */
const exitX = ref<number>(intakeExit.x)
const exitMotion = computed(() => ({ ...intakeExit, x: exitX.value }))

let controller: AbortController | null = null
let slowTimer: ReturnType<typeof setTimeout> | undefined

async function check(options: { announce?: boolean } = {}) {
  const body = profile.value
  if (!body) return
  controller?.abort()
  const current = new AbortController()
  controller = current
  state.value = { status: 'checking' }
  clearTimeout(slowTimer)
  slow.value = options.announce === true
  slowTimer = setTimeout(() => (slow.value = true), SLOW_MS)
  try {
    state.value = { status: 'ok', result: await requestProfileCheck(body, current.signal) }
  } catch (cause) {
    if (current.signal.aborted) return
    const failure = checkFailure(cause instanceof ApiProblem ? cause : ApiProblem.network(cause))
    state.value = failure.kind === 'invalid' ? { status: 'invalid', errors: failure.errors } : { status: 'failed', message: failure.message }
  } finally {
    if (!current.signal.aborted) {
      clearTimeout(slowTimer)
      slow.value = false
    }
  }
}

async function retry() {
  if (checking.value) return
  const hadFocus = document.activeElement === retryButton.value
  retrying.value = true
  await check({ announce: true })
  if (state.value.status === 'failed') return
  retrying.value = false
  await nextTick()
  if (hadFocus) (cta.value?.$el as HTMLElement | undefined)?.focus()
}

function focusStatus() {
  statusBox.value?.focus({ preventScroll: true })
  statusBox.value?.scrollIntoView({ block: 'nearest' })
}

function proceed() {
  if (!ready.value) {
    focusStatus()
    return
  }
  exitX.value = -intakeExit.x
  void router.push('/create/access')
}

function edit(step: IntakeStep) {
  exitX.value = intakeExit.x
  void router.push({ name: INTAKE_ROUTE, query: { step, from: REVIEW_RETURN } })
}

function back() {
  exitX.value = intakeExit.x
  const location = { name: INTAKE_ROUTE, query: { step: 'time' } }
  if (router.options.history.state.back === router.resolve(location).fullPath) router.back()
  else void router.push(location)
}

onMounted(() => {
  window.scrollTo({ top: 0 })
  heading.value?.focus({ preventScroll: true })
  void check()
})

onBeforeUnmount(() => {
  controller?.abort()
  clearTimeout(slowTimer)
})
</script>

<template>
  <motion.main
    id="main"
    class="review"
    :class="{ 'review--reload': firstLoad }"
    :initial="false"
    :animate="{ opacity: 1 }"
    :exit="exitMotion"
    :style="{ '--intake-clear-y': `${clearY}px` }"
  >
    <header class="review__top">
      <RouterLink class="review__link" to="/">
        <CosmosIcon class="review__link-icon" name="arrow-left" />
        <span>На главную</span>
      </RouterLink>
    </header>

    <div class="review__column">
      <ProgressStep class="review__progress" :current="intakeSteps.length" :total="intakeSteps.length" done />

      <h1 ref="heading" class="review__title" tabindex="-1">
        <span class="review__title-line">Проверь</span>
        <span class="review__title-accent">свою историю.</span>
      </h1>
      <p class="review__lead">По этим данным мы рассчитаем карту. Любой пункт можно изменить.</p>

      <form class="review__form" novalidate @submit.prevent="proceed">
        <dl class="review__list">
          <div
            v-for="(item, i) in items"
            :key="item.step"
            class="review__item"
            :class="{ 'review__item--invalid': errors[item.step] }"
            :data-step="item.step"
            :style="{ '--i': i }"
          >
            <dt class="review__label">{{ item.label }}</dt>
            <dd class="review__value">{{ item.value }}</dd>
            <dd v-if="errors[item.step]" :key="`e:${errors[item.step]}`" class="review__note review__note--error">
              <CosmosIcon class="review__note-icon" name="alert" />
              <span><span class="visually-hidden">Ошибка: </span>{{ errors[item.step] }}</span>
            </dd>
            <dd v-else class="review__note">{{ item.note }}</dd>
            <dd class="review__edit">
              <button class="review__edit-button" type="button" :aria-label="item.editLabel" @click="edit(item.step)">Изменить</button>
            </dd>
          </div>
        </dl>

        <div class="review__actions">
          <PrimaryCTA ref="cta" class="review__next" :class="{ 'is-dimmed': dimmed }" :aria-disabled="ready ? undefined : 'true'">Продолжить</PrimaryCTA>
          <button class="review__link" type="button" @click="back">
            <CosmosIcon class="review__link-icon" name="arrow-left" />
            <span>Назад</span>
          </button>
        </div>

        <div ref="statusBox" class="review__status" tabindex="-1">
          <p class="review__status-text" role="status">
            <template v-if="checking && slow">
              <span class="review__pulse" aria-hidden="true" />
              <span>Сверяем данные…</span>
            </template>
            <template v-else-if="state.status === 'ok'">
              <CosmosIcon class="review__status-icon" name="check" />
              <span>Данные проверены.</span>
            </template>
            <span v-else-if="state.status === 'invalid'">
              Нужно поправить:
              <template v-for="(step, i) in invalidSteps(state.errors)" :key="step">
                <button class="review__fix" type="button" @click="edit(step)">{{ blockNames[step] }}</button>{{ i < invalidSteps(state.errors).length - 1 ? ', ' : '.' }}
              </template>
            </span>
            <span v-else-if="state.status === 'failed'">{{ state.message }}</span>
          </p>
          <button
            v-if="showRetry"
            ref="retryButton"
            class="review__retry"
            type="button"
            :aria-disabled="checking ? 'true' : undefined"
            @click="retry"
          >
            Проверить ещё раз
          </button>
        </div>
      </form>
    </div>

    <footer class="review__foot">
      <p class="review__privacy">Ответы хранятся только в этой вкладке.</p>
      <MotionToggle class="review__toggle" />
    </footer>
  </motion.main>
</template>

<style scoped>
/* Page frame: the same as IntakeView, so the column does not move between step 04 and the review. */
.review {
  --u: var(--scene-u, 1px);
  position: relative;
  z-index: var(--cosmos-z-content);
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  padding: 0 var(--cosmos-page-gutter);
  overflow-x: clip;
}

.review__top {
  display: flex;
  align-items: center;
  min-height: 64px;
}

.review__link {
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

.review__link-icon {
  font-size: 18px;
  transition: transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.review__column {
  width: 100%;
  max-width: 560px;
  padding-top: max(12px, calc(20svh - 64px), calc(var(--intake-clear-y, 0px) - 72px));
}

@media (min-aspect-ratio: 6/5) and (max-width: 959px), (min-aspect-ratio: 6/5) and (max-height: 599px) {
  .review::before {
    position: fixed;
    inset: 0;
    z-index: -1;
    background: linear-gradient(to right, rgba(7, 17, 29, .88), rgba(7, 17, 29, .7) 55%, rgba(7, 17, 29, 0));
    content: "";
    pointer-events: none;
  }

  .review__column {
    padding-top: 12px;
  }
}

.review__progress {
  margin-bottom: 16px;
}

/* Heading: the question's two lines, a size smaller so the four answers fit 1440×900 (C-R4). */
.review__title {
  margin: 0;
  color: #f6f4ef;
  font-size: clamp(32px, 8.6vw, 36px);
  font-weight: 300;
  letter-spacing: -0.025em;
  line-height: 1.02;
}

.review__title:focus {
  outline: none;
}

.review__title-line,
.review__title-accent {
  display: block;
}

.review__title-accent {
  color: var(--cosmos-gold-pale);
  font-family: var(--cosmos-font-serif);
  font-size: 1.078em;
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.review__lead {
  max-width: 44ch;
  margin: 10px 0 0;
  color: var(--cosmos-muted);
  font-size: 16px;
  line-height: 1.5;
  text-wrap: pretty;
}

/* Rhythm instead of rules: 24px between blocks, 4–8px inside one. */
.review__list {
  display: grid;
  gap: 24px;
  margin: 32px 0 0;
}

.review__item {
  display: grid;
  grid-template-areas:
    "label edit"
    "value value"
    "note note";
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 16px;
  align-items: center;
}

.review__label {
  grid-area: label;
  color: #a3a7b0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: var(--cosmos-tracking-micro);
  line-height: 1;
  text-transform: uppercase;
}

/* The answer sits on the Field underline it was typed on. */
.review__value {
  position: relative;
  grid-area: value;
  margin: 0;
  padding: 8px 0 10px;
  color: var(--cosmos-text);
  font-size: 24px;
  font-weight: 300;
  letter-spacing: -0.01em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.review__value::before,
.review__value::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  content: "";
  pointer-events: none;
}

.review__value::before {
  background: rgba(225, 218, 207, .32);
  transition: background-color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

/* M04 accent: a gold stroke drawn left to right, then cooling into the plain line. */
.review__value::after {
  background: var(--cosmos-gold);
  opacity: 0;
  transform-origin: 0 50%;
}

.review__item--invalid .review__value::before {
  background: var(--cosmos-danger);
}

.review__note {
  grid-area: note;
  min-height: 1.45em;
  margin: 8px 0 0;
  color: var(--cosmos-faint);
  font-size: 15px;
  line-height: 1.45;
  text-wrap: pretty;
}

/* Errors take the note's place and may grow to more lines; nothing is cut. */
.review__note--error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--cosmos-danger);
  animation: review-note-in var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.review__note-icon {
  flex: none;
  margin-top: 2px;
  font-size: 16px;
}

.review__edit {
  grid-area: edit;
  justify-self: end;
  margin: 0;
}

/* 44px target around a small word; negative margins keep the label row thin. */
.review__edit-button,
.review__fix,
.review__retry {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--cosmos-gold-light);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(227, 201, 148, .35);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.3em;
  transition: text-decoration-color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.review__edit-button {
  min-width: var(--cosmos-target-min);
  min-height: var(--cosmos-target-min);
  margin-block: -16px;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.review__item--invalid .review__edit-button {
  text-decoration-color: currentColor;
}

.review__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 28px;
  margin-top: 32px;
}

.review__next {
  --cta-width: min(100%, 220px);
  transition: opacity var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.review__next.is-dimmed {
  opacity: 0.5;
  cursor: default;
}

/* Under the buttons: when it grows (retry), only the footer moves. */
.review__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 20px;
  min-height: 24px;
  margin-top: 14px;
  outline-offset: 6px;
}

.review__status:focus:not(:focus-visible) {
  outline: none;
}

.review__status-text {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--cosmos-muted);
  font-size: 14px;
  line-height: 1.45;
  text-wrap: pretty;
  animation: review-fade var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.review__status-icon {
  flex: none;
  color: var(--cosmos-gold-light);
  font-size: 18px;
}

/* «Сверяем данные…»: the thin running line of the city search. */
.review__pulse {
  position: relative;
  flex: none;
  width: 28px;
  height: 1px;
  overflow: hidden;
  background: rgba(225, 218, 207, .2);
}

.review__pulse::after {
  position: absolute;
  inset: 0;
  background: var(--cosmos-gold-pale);
  animation: review-pulse 1.1s var(--cosmos-ease-in-out) infinite;
  content: "";
}

.review__retry {
  min-height: var(--cosmos-target-min);
  font-size: 14px;
}

.review__retry[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}

.review__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-top: auto;
  padding: 40px 0 max(20px, env(safe-area-inset-bottom));
}

.review__privacy {
  margin: 0;
  color: var(--cosmos-faint);
  font-size: 13px;
  line-height: 1.45;
}

@media (hover: hover) and (pointer: fine) {
  .review__link:hover {
    color: var(--cosmos-text);
  }

  .review__link:hover .review__link-icon {
    transform: translateX(-3px);
  }

  .review__edit-button:hover,
  .review__fix:hover,
  .review__retry:not([aria-disabled='true']):hover {
    text-decoration-color: currentColor;
  }
}

/* Reference layout: the column on the hero's text line, the planet keeps the right. */
@media (min-width: 960px) and (min-height: 600px) and (min-aspect-ratio: 6/5) {
  .review {
    padding: 0 calc(73 * var(--u)) 0 calc(74.5 * var(--u));
  }

  .review__top {
    min-height: calc(110 * var(--u));
  }

  .review__column {
    max-width: min(560px, calc(560 * var(--u)));
    padding-top: calc(48 * var(--u));
  }

  .review__progress {
    margin-bottom: calc(34 * var(--u));
  }

  .review__title {
    font-size: clamp(40px, calc(52 * var(--u)), 60px);
  }

  .review__lead {
    margin-top: calc(14 * var(--u));
    font-size: max(16px, calc(17 * var(--u)));
  }

  .review__list {
    gap: calc(24 * var(--u));
    margin-top: calc(36 * var(--u));
  }

  .review__value {
    font-size: 28px;
  }

  .review__actions {
    margin-top: calc(36 * var(--u));
  }

  .review__next {
    --cta-width: calc(220 * var(--u));
    --cta-height: calc(58 * var(--u));
    --cta-padding-x: calc(24.5 * var(--u));
    --cta-padding-right: calc(21 * var(--u));
    --cta-font: max(14px, calc(15 * var(--u)));
  }

  .review__foot {
    min-height: calc(110 * var(--u));
    padding: 32px 0 24px;
  }

  .review__toggle {
    --toggle-ring: calc(37 * var(--u));
    --toggle-gap: calc(14 * var(--u));
    --toggle-font: max(11px, calc(11.5 * var(--u)));
  }
}

/*
 * Entrance (SCR-03 §2): from step 04 the column slides in from the right as
 * one layer; on a reload it rises like the first step. The answers are
 * readable from the first frame: the accents change colour and the line only.
 */
.review__column {
  animation: review-slide var(--cosmos-dur-step-enter) var(--cosmos-ease-out) 80ms both;
}

.review--reload .review__column {
  animation: review-rise 600ms var(--cosmos-ease-out) 60ms both;
}

.review__top,
.review__foot {
  animation: review-fade var(--cosmos-dur-step-enter) var(--cosmos-ease-out) both;
}

.review__value {
  animation: review-value 300ms var(--cosmos-ease-out) calc(300ms + var(--i, 0) * 90ms) both;
}

.review__value::after {
  animation: review-accent 700ms var(--cosmos-ease-out) calc(300ms + var(--i, 0) * 90ms) both;
}

@keyframes review-slide {
  from {
    opacity: 0;
    filter: blur(2px);
    transform: translateX(20px);
  }
}

@keyframes review-rise {
  from {
    opacity: 0;
    filter: blur(6px);
    transform: translateY(12px);
  }
}

@keyframes review-fade {
  from {
    opacity: 0;
  }
}

@keyframes review-value {
  from {
    color: var(--cosmos-muted);
  }
}

@keyframes review-accent {
  0% {
    opacity: 1;
    transform: scaleX(0);
  }

  43% {
    opacity: 1;
    transform: scaleX(1);
  }

  100% {
    opacity: 0;
    transform: scaleX(1);
  }
}

@keyframes review-note-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

@keyframes review-pulse {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .review__column,
  .review--reload .review__column {
    animation: review-fade 200ms linear both;
  }

  .review__value,
  .review__value::after,
  .review__pulse {
    animation: none;
  }

  .review__pulse {
    display: none;
  }

  .review__note--error {
    animation-name: review-fade;
  }
}
</style>
