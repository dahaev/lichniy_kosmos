<script setup lang="ts">
import { motion } from 'motion-v'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { ApiProblem } from '@/api/problem'
import { isFirstNavigation } from '@/app/router'
import MotionToggle from '@/features/home/MotionToggle.vue'
import { REVIEW_ROUTE } from '@/features/intake/guard'
import { intakeSteps, stepScene } from '@/features/intake/steps'
import { intakeExit } from '@/motion/presets'
import { useSceneStore } from '@/scene/sceneStore'
import CosmosIcon from '@/ui/CosmosIcon.vue'
import Field from '@/ui/Field.vue'
import PrimaryCTA from '@/ui/PrimaryCTA.vue'
import ProgressStep from '@/ui/ProgressStep.vue'

import { accessTexts, codeFailure, CodeRefused, fetchSession, maskSpeech, maskText, startCodeSession, type CodeFailure, type CodeSession } from './access'

// SCR-04, slice 5: one code line on the review's underline. The scene keeps
// the review's frame (Р-A2) and does not react to a code (M05). The typed
// code stays in this component's memory and is wiped once accepted.

type Phase = 'loading' | 'entry' | 'session'

/** A quick answer changes nothing on screen; only a slow one shows its status line. */
const SLOW_MS = 300
/** The on-screen keyboard has opened by then, so centring accounts for it. */
const KEYBOARD_MS = 300
const HINT = 'Например, LK-XXXXX-… Регистр и дефисы не важны.'
const EXTRA_ID = 'access-code-extra'

const router = useRouter()
const scene = useSceneStore()
const firstLoad = isFirstNavigation(router)

const heading = useTemplateRef<HTMLElement>('heading')
const input = useTemplateRef<HTMLInputElement>('input')
const cta = useTemplateRef<InstanceType<typeof PrimaryCTA>>('cta')
const replaceButton = useTemplateRef<HTMLButtonElement>('replaceButton')

const phase = ref<Phase>('loading')
/** The code session of this browser, as the server last described it. */
const session = ref<CodeSession | null>(null)
/** The session was open before this visit: «уже принят», no accent. */
const restored = ref(false)
const code = ref('')
/** The visitor chose «Использовать / Ввести другой код»: the next code replaces the session (А8). */
const replacing = ref(false)
const fieldError = ref<string | null>(null)
const conflict = ref<{ mask: string | null } | null>(null)
const notice = ref<string | null>(null)
const submitting = ref(false)
const slow = ref(false)
const sessionSlow = ref(false)
const locked = ref(false)

const entitlement = computed(() => session.value?.entitlement ?? null)
const mask = computed(() => entitlement.value?.code_mask ?? '')
const consumed = computed(() => phase.value === 'session' && entitlement.value?.state === 'consumed')
const replaceNote = computed(() => phase.value === 'entry' && replacing.value && session.value !== null && !conflict.value)
const hint = computed(() => (conflict.value || replaceNote.value ? undefined : HINT))
const busy = computed(() => submitting.value && slow.value)
const inactive = computed(() => phase.value === 'loading' || (phase.value === 'entry' && (busy.value || locked.value)))
const dimmed = computed(() => (phase.value === 'loading' && sessionSlow.value) || busy.value || locked.value)

const primaryLabel = computed(() => {
  if (phase.value !== 'session') return 'Проверить код'
  return consumed.value ? 'Открыть разбор' : 'Продолжить'
})

const sessionLine = computed(() => {
  const shown = maskText(mask.value)
  const spoken = maskSpeech(mask.value)
  if (consumed.value) {
    return restored.value
      ? { shown: `По коду ${shown} уже создан разбор.`, spoken: `По коду, оканчивающемуся на ${mask.value.split('').join(' ')}, уже создан разбор.` }
      : { shown: 'По этому коду уже создан разбор.', spoken: 'По этому коду уже создан разбор.' }
  }
  const verb = restored.value ? 'уже принят' : 'принят'
  return { shown: `Код ${shown} ${verb}.`, spoken: `${spoken[0]?.toUpperCase() ?? ''}${spoken.slice(1)}, ${verb}.` }
})

const conflictLine = computed(() => {
  const open = conflict.value?.mask
  const lead = 'В этом браузере уже открыт другой код'
  return open ? { shown: `${lead} (${maskText(open)}).`, spoken: `${lead}, ${maskSpeech(open)}.` } : { shown: `${lead}.`, spoken: `${lead}.` }
})

/** Read by the status line when the visible change sits elsewhere (SCR-04 §0.12). */
const announcement = computed(() => {
  if (fieldError.value) return `Ошибка: ${fieldError.value}`
  if (conflict.value) return 'В этом браузере уже открыт другой код. Заменить его?'
  if (phase.value === 'session' && !restored.value) return sessionLine.value.spoken
  return ''
})

/** Same line as the review: the lowest point of the planet over the intake frames. */
const clearY = computed(() => Math.max(0, ...intakeSteps.map((s) => {
  const frame = scene.frameFor(stepScene(s))
  return frame ? frame.planet.y + frame.planet.r : 0
})))

/** «Продолжить» and «Открыть разбор» leave to the left, «Назад» to the right (SCR-04 §2). */
const exitX = ref<number>(intakeExit.x)
const exitMotion = computed(() => ({ ...intakeExit, x: exitX.value }))

let codeController: AbortController | null = null
let sessionController: AbortController | null = null
let slowTimer: ReturnType<typeof setTimeout> | undefined
let lockTimer: ReturnType<typeof setTimeout> | undefined
let keyboardTimer: ReturnType<typeof setTimeout> | undefined

const isTouch = () => window.matchMedia('(pointer: coarse)').matches

function describedBy(fieldMessage: string | undefined): string | undefined {
  const ids = [fieldMessage, conflict.value || replaceNote.value ? EXTRA_ID : undefined].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

function focusInput() {
  input.value?.focus({ preventScroll: true })
}

function focusPrimary() {
  ;(cta.value?.$el as HTMLElement | undefined)?.focus()
}

function onInputFocus() {
  if (!isTouch()) return
  clearTimeout(keyboardTimer)
  keyboardTimer = setTimeout(() => input.value?.scrollIntoView({ block: 'center' }), KEYBOARD_MS)
}

/** A code is longer than the line: out of editing, show its end, where a mistyped symbol usually sits. */
function onInputBlur() {
  clearTimeout(keyboardTimer)
  // Chrome resets a text field to its start after blur, so the end is shown a frame later.
  requestAnimationFrame(() => {
    const el = input.value
    if (el && document.activeElement !== el) el.scrollLeft = el.scrollWidth
  })
}

function clearMessages() {
  fieldError.value = null
  conflict.value = null
  notice.value = null
}

function lock(seconds: number) {
  locked.value = true
  clearTimeout(lockTimer)
  lockTimer = setTimeout(() => {
    locked.value = false
    notice.value = null
  }, seconds * 1000)
}

async function accept(next: CodeSession) {
  code.value = ''
  clearMessages()
  session.value = next
  restored.value = false
  replacing.value = false
  phase.value = 'session'
  await nextTick()
  focusPrimary()
}

async function refuse(failure: CodeFailure, signal: AbortSignal) {
  clearMessages()
  switch (failure.kind) {
    case 'field':
      fieldError.value = failure.message
      focusInput()
      return
    case 'conflict': {
      // The mask of the open code comes from the server, not from memory: it may be another tab's.
      const current = await fetchSession(signal)
      if (signal.aborted) return
      if (current?.principal === 'code') {
        session.value = current
        restored.value = true
      }
      conflict.value = { mask: current?.principal === 'code' ? current.entitlement.code_mask : null }
      await nextTick()
      replaceButton.value?.focus()
      return
    }
    case 'limited':
      notice.value = failure.message
      if (failure.retryAfter) lock(failure.retryAfter)
      return
    case 'failed':
      notice.value = failure.message
  }
}

async function submit(replace: boolean) {
  if (submitting.value || locked.value) return
  if (code.value.trim() === '') {
    clearMessages()
    fieldError.value = accessTexts.empty
    focusInput()
    return
  }
  submitting.value = true
  clearTimeout(slowTimer)
  slowTimer = setTimeout(() => (slow.value = true), SLOW_MS)
  const current = new AbortController()
  codeController = current
  try {
    await accept(await startCodeSession(code.value, replace, current.signal))
  } catch (cause) {
    if (current.signal.aborted) return
    await refuse(cause instanceof CodeRefused ? cause.failure : codeFailure(ApiProblem.network(cause)), current.signal)
  } finally {
    if (!current.signal.aborted) {
      clearTimeout(slowTimer)
      slow.value = false
      submitting.value = false
    }
  }
}

function primary() {
  if (phase.value === 'entry') {
    void submit(replacing.value)
    return
  }
  const current = phase.value === 'session' ? entitlement.value : null
  if (!current) return
  exitX.value = -intakeExit.x
  if (current.state === 'available') void router.push('/create/consent')
  else void router.push({ name: 'order', params: { id: current.order_id } })
}

async function useOtherCode() {
  code.value = ''
  clearMessages()
  replacing.value = true
  phase.value = 'entry'
  await nextTick()
  focusInput()
}

async function showSession() {
  code.value = ''
  clearMessages()
  replacing.value = false
  phase.value = 'session'
  await nextTick()
  focusPrimary()
}

function confirmReplace() {
  void submit(true)
}

async function keepCurrent() {
  if (session.value) {
    await showSession()
    return
  }
  conflict.value = null
  focusInput()
}

function back() {
  exitX.value = intakeExit.x
  const location = { name: REVIEW_ROUTE }
  if (router.options.history.state.back === router.resolve(location).fullPath) router.back()
  else void router.push(location)
}

async function loadSession() {
  const current = new AbortController()
  sessionController = current
  const timer = setTimeout(() => (sessionSlow.value = true), SLOW_MS)
  const result = await fetchSession(current.signal)
  clearTimeout(timer)
  if (current.signal.aborted) return
  sessionSlow.value = false
  if (result?.principal === 'code') {
    session.value = result
    restored.value = true
    phase.value = 'session'
  } else {
    phase.value = 'entry'
  }
  await nextTick()
  // Desktop lands in the field; touch keeps the heading so no keyboard rises (§0.12).
  const untouched = document.activeElement === heading.value || document.activeElement === document.body
  if (phase.value === 'entry' && untouched && !isTouch()) focusInput()
}

onMounted(() => {
  window.scrollTo({ top: 0 })
  heading.value?.focus({ preventScroll: true })
  void loadSession()
})

onBeforeUnmount(() => {
  codeController?.abort()
  sessionController?.abort()
  clearTimeout(slowTimer)
  clearTimeout(lockTimer)
  clearTimeout(keyboardTimer)
  code.value = ''
})
</script>

<template>
  <motion.main
    id="main"
    class="access"
    :class="{ 'access--reload': firstLoad }"
    :initial="false"
    :animate="{ opacity: 1 }"
    :exit="exitMotion"
    :style="{ '--intake-clear-y': `${clearY}px` }"
  >
    <header class="access__top">
      <RouterLink class="access__link" to="/">
        <CosmosIcon class="access__link-icon" name="arrow-left" />
        <span>На главную</span>
      </RouterLink>
    </header>

    <div class="access__column">
      <ProgressStep class="access__progress" :current="intakeSteps.length" :total="intakeSteps.length" done />

      <h1 ref="heading" class="access__title" tabindex="-1">
        <span class="access__title-line">Данные заполнены.</span>
        <span class="access__title-accent">Остался доступ к персональному разбору.</span>
      </h1>
      <p class="access__lead">Введи код доступа, чтобы продолжить создание своей натальной карты</p>

      <form class="access__form" novalidate @submit.prevent="primary">
        <div class="access__slot" :data-phase="phase">
          <div v-if="phase === 'entry'" key="entry" class="access__state">
            <Field id="access-code" label="Код доступа" :hint="hint" :error="fieldError">
              <template #default="{ describedBy: messageId, invalid }">
                <input
                  id="access-code"
                  ref="input"
                  v-model="code"
                  class="access__input"
                  type="text"
                  autocomplete="off"
                  autocapitalize="characters"
                  autocorrect="off"
                  spellcheck="false"
                  inputmode="text"
                  enterkeyhint="go"
                  maxlength="64"
                  :aria-invalid="invalid || undefined"
                  :aria-describedby="describedBy(messageId)"
                  @focus="onInputFocus"
                  @blur="onInputBlur"
                />
              </template>
            </Field>

            <div v-if="conflict" :id="EXTRA_ID" class="access__extra">
              <p class="access__note access__note--plain">
                <span aria-hidden="true">{{ conflictLine.shown }}</span>
                <span class="visually-hidden">{{ conflictLine.spoken }}</span>
              </p>
              <div class="access__choice">
                <button ref="replaceButton" class="access__choice-button" type="button" :aria-disabled="busy ? 'true' : undefined" @click="confirmReplace">Заменить</button>
                <button class="access__text-button access__text-button--quiet" type="button" @click="keepCurrent">Оставить текущий</button>
              </div>
            </div>
            <div v-else-if="replaceNote" :id="EXTRA_ID" class="access__extra">
              <p class="access__note">
                Код <span aria-hidden="true">{{ maskText(mask) }}</span><span class="visually-hidden">{{ maskSpeech(mask) }}</span> закроется в этом браузере. Его можно будет ввести снова.
              </p>
              <button class="access__text-button" type="button" @click="showSession">Отмена</button>
            </div>
          </div>

          <div v-else-if="phase === 'session' && entitlement" :key="`session:${entitlement.id}`" class="access__state">
            <p class="access__label">Код доступа</p>
            <p class="access__value" :class="{ 'access__value--fresh': !restored }">
              <CosmosIcon v-if="!consumed" class="access__value-icon" name="check" />
              <span aria-hidden="true">{{ sessionLine.shown }}</span>
              <span class="visually-hidden">{{ sessionLine.spoken }}</span>
            </p>
            <p v-if="consumed" class="access__note">Твоя анкета сохранится для другого кода.</p>
            <p v-else class="access__under">
              <button class="access__text-button" type="button" @click="useOtherCode">Использовать другой код</button>
            </p>
          </div>
        </div>

        <div class="access__actions" :class="{ 'access__actions--stacked': consumed }">
          <PrimaryCTA ref="cta" class="access__next" :class="{ 'is-dimmed': dimmed }" :aria-disabled="inactive ? 'true' : undefined">
            {{ primaryLabel }}
          </PrimaryCTA>
          <button v-if="consumed" class="access__text-button access__other" type="button" @click="useOtherCode">Ввести другой код</button>
          <button class="access__link" type="button" @click="back">
            <CosmosIcon class="access__link-icon" name="arrow-left" />
            <span>Назад</span>
          </button>
        </div>

        <div class="access__status">
          <p class="access__status-text" role="status">
            <template v-if="phase === 'loading' && sessionSlow">
              <span class="access__pulse" aria-hidden="true" />
              <span>Проверяем доступ…</span>
            </template>
            <template v-else-if="busy">
              <span class="access__pulse" aria-hidden="true" />
              <span>Проверяем код…</span>
            </template>
            <span v-else-if="notice">{{ notice }}</span>
            <span v-else-if="announcement" class="visually-hidden">{{ announcement }}</span>
          </p>
        </div>
      </form>

      <!-- Becomes a link to /natal-chart with SCR-11 (Р-A3); until then plain text, out of the Tab order. -->
      <p v-if="phase !== 'session'" class="access__where">
        <span class="access__where-question">Где получить код?</span>
        Расскажем на странице о натальной карте — она скоро появится.
      </p>
    </div>

    <footer class="access__foot">
      <p class="access__privacy">Ответы хранятся только в этой вкладке.</p>
      <MotionToggle class="access__toggle" />
    </footer>
  </motion.main>
</template>

<style scoped>
/* Page frame: the same as the review, so the column does not move between SCR-03 and SCR-04. */
.access {
  --u: var(--scene-u, 1px);
  position: relative;
  z-index: var(--cosmos-z-content);
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  padding: 0 var(--cosmos-page-gutter);
  overflow-x: clip;
}

.access__top {
  display: flex;
  align-items: center;
  min-height: 64px;
}

.access__link {
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

.access__link-icon {
  font-size: 18px;
  transition: transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.access__column {
  width: 100%;
  max-width: 560px;
  padding-top: max(12px, calc(20svh - 64px), calc(var(--intake-clear-y, 0px) - 72px));
}

@media (min-aspect-ratio: 6/5) and (max-width: 959px), (min-aspect-ratio: 6/5) and (max-height: 599px) {
  .access::before {
    position: fixed;
    inset: 0;
    z-index: -1;
    background: linear-gradient(to right, rgba(7, 17, 29, .88), rgba(7, 17, 29, .7) 55%, rgba(7, 17, 29, 0));
    content: "";
    pointer-events: none;
  }

  .access__column {
    padding-top: 12px;
  }
}

.access__progress {
  margin-bottom: 16px;
}

.access__title {
  margin: 0;
  color: #f6f4ef;
  font-size: clamp(32px, 8.6vw, 36px);
  font-weight: 300;
  letter-spacing: -0.025em;
  line-height: 1.02;
}

.access__title:focus {
  outline: none;
}

.access__title-line,
.access__title-accent {
  display: block;
}

.access__title-accent {
  color: var(--cosmos-gold-pale);
  font-family: var(--cosmos-font-serif);
  font-size: 1.078em;
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.2;
  text-wrap: balance;
}

.access__lead {
  max-width: 44ch;
  margin: 10px 0 0;
  color: var(--cosmos-muted);
  font-size: 16px;
  line-height: 1.5;
  text-wrap: pretty;
}

.access__form {
  margin-top: 32px;
}

/* The slot keeps the height of the field from the first frame: the buttons never jump (§0.11). */
.access__slot {
  min-height: 112px;
}

.access__state {
  animation: access-fade var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.access__slot :deep(.field__message) {
  font-size: 15px;
}

.access__input {
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
  letter-spacing: var(--cosmos-tracking-micro);
  line-height: 1.3;
  text-transform: uppercase;
  scroll-margin-block: 32px 56px;
}

.access__input:focus {
  outline: none;
}

/* The session states mirror Field: its micro label, a line of the same height, the slot under it. */
.access__label {
  margin: 0 0 10px;
  color: #a3a7b0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: var(--cosmos-tracking-micro);
  line-height: 1;
  text-transform: uppercase;
}

.access__value {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  margin: 0;
  padding: 6px 0 10px;
  color: var(--cosmos-text);
  font-size: 20px;
  font-weight: 300;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.access__value::before,
.access__value::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  content: "";
  pointer-events: none;
}

.access__value::before {
  background: rgba(225, 218, 207, .32);
}

/* M05: the accepted line draws in gold and cools into the plain line, as M04 on the review. */
.access__value::after {
  background: var(--cosmos-gold);
  opacity: 0;
  transform-origin: 0 50%;
}

.access__value--fresh::after {
  animation: access-accent 700ms var(--cosmos-ease-out) both;
}

.access__value-icon {
  flex: none;
  color: var(--cosmos-gold-light);
  font-size: 22px;
}

.access__extra,
.access__under,
.access__note {
  margin: 12px 0 0;
}

.access__extra {
  animation: access-fade var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.access__note {
  color: var(--cosmos-faint);
  font-size: 15px;
  line-height: 1.45;
  text-wrap: pretty;
}

.access__extra .access__note {
  margin: 0;
}

.access__note--plain {
  color: var(--cosmos-muted);
}

.access__choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  margin-top: 12px;
}

/* SecondaryCTA's hairline turned into the button's own outline: the decision of the conflict. */
.access__choice-button {
  min-height: var(--cosmos-target-min);
  margin: 0;
  padding: 0 20px;
  border: 1px solid rgba(225, 218, 207, .38);
  border-radius: var(--cosmos-radius-sm);
  background: none;
  color: var(--cosmos-text);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition:
    border-color var(--cosmos-dur-micro) var(--cosmos-ease-out),
    opacity var(--cosmos-dur-micro) var(--cosmos-ease-out),
    transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.access__choice-button:active {
  transform: scale(0.97);
}

.access__text-button.access__text-button--quiet {
  color: var(--cosmos-muted);
  text-decoration-color: rgba(174, 183, 189, .35);
}

.access__choice-button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}

.access__text-button {
  min-height: var(--cosmos-target-min);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--cosmos-gold-light);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(227, 201, 148, .35);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.3em;
  transition: text-decoration-color var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.access__extra > .access__text-button,
.access__under .access__text-button {
  margin-block: -6px;
}

.access__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 28px;
  margin-top: 24px;
}

.access__actions--stacked .access__link {
  flex-basis: 100%;
}

.access__next {
  --cta-width: min(100%, 220px);
  transition: opacity var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.access__next.is-dimmed {
  opacity: 0.5;
  cursor: default;
}

.access__status {
  min-height: 24px;
  margin-top: 14px;
}

.access__status-text {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--cosmos-muted);
  font-size: 14px;
  line-height: 1.45;
  text-wrap: pretty;
  animation: access-fade var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

/* «Проверяем код…»: the thin running line of the review. */
.access__pulse {
  position: relative;
  flex: none;
  width: 28px;
  height: 1px;
  overflow: hidden;
  background: rgba(225, 218, 207, .2);
}

.access__pulse::after {
  position: absolute;
  inset: 0;
  background: var(--cosmos-gold-pale);
  animation: access-pulse 1.1s var(--cosmos-ease-in-out) infinite;
  content: "";
}

.access__where {
  max-width: 44ch;
  margin: 20px 0 0;
  color: var(--cosmos-faint);
  font-size: 14px;
  line-height: 1.5;
  text-wrap: pretty;
}

.access__where-question {
  color: var(--cosmos-muted);
}

.access__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-top: auto;
  padding: 40px 0 max(20px, env(safe-area-inset-bottom));
}

.access__privacy {
  margin: 0;
  color: var(--cosmos-faint);
  font-size: 13px;
  line-height: 1.45;
}

@media (hover: hover) and (pointer: fine) {
  .access__link:hover,
  .access__text-button.access__text-button--quiet:hover {
    color: var(--cosmos-text);
  }

  .access__link:hover .access__link-icon {
    transform: translateX(-3px);
  }

  .access__choice-button:not([aria-disabled='true']):hover {
    border-color: rgba(225, 218, 207, .7);
  }

  .access__text-button:hover {
    text-decoration-color: currentColor;
  }
}

/* Reference layout: the column on the hero's text line, the planet keeps the right. */
@media (min-width: 960px) and (min-height: 600px) and (min-aspect-ratio: 6/5) {
  .access {
    padding: 0 calc(73 * var(--u)) 0 calc(74.5 * var(--u));
  }

  .access__top {
    min-height: calc(110 * var(--u));
  }

  .access__column {
    max-width: min(560px, calc(560 * var(--u)));
    padding-top: calc(48 * var(--u));
  }

  .access__progress {
    margin-bottom: calc(34 * var(--u));
  }

  .access__title {
    font-size: clamp(40px, calc(52 * var(--u)), 60px);
  }

  .access__lead {
    margin-top: calc(14 * var(--u));
    font-size: max(16px, calc(17 * var(--u)));
  }

  .access__form {
    margin-top: calc(36 * var(--u));
  }

  .access__input {
    font-size: 28px;
  }

  .access__value {
    font-size: 22px;
  }

  .access__actions {
    margin-top: calc(28 * var(--u));
  }

  .access__next {
    --cta-width: calc(220 * var(--u));
    --cta-height: calc(58 * var(--u));
    --cta-padding-x: calc(24.5 * var(--u));
    --cta-padding-right: calc(21 * var(--u));
    --cta-font: max(14px, calc(15 * var(--u)));
  }

  .access__foot {
    min-height: calc(110 * var(--u));
    padding: 32px 0 24px;
  }

  .access__toggle {
    --toggle-ring: calc(37 * var(--u));
    --toggle-gap: calc(14 * var(--u));
    --toggle-font: max(11px, calc(11.5 * var(--u)));
  }
}

/*
 * Entrance (SCR-04 §2): from the review the column slides in from the right
 * as one layer; on a reload it rises like the review. The field works at once.
 */
.access__column {
  animation: access-slide var(--cosmos-dur-step-enter) var(--cosmos-ease-out) 80ms both;
}

.access--reload .access__column {
  animation: access-rise 600ms var(--cosmos-ease-out) 60ms both;
}

.access__top,
.access__foot {
  animation: access-fade var(--cosmos-dur-step-enter) var(--cosmos-ease-out) both;
}

@keyframes access-slide {
  from {
    opacity: 0;
    filter: blur(2px);
    transform: translateX(20px);
  }
}

@keyframes access-rise {
  from {
    opacity: 0;
    filter: blur(6px);
    transform: translateY(12px);
  }
}

@keyframes access-fade {
  from {
    opacity: 0;
  }
}

@keyframes access-accent {
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

@keyframes access-pulse {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .access__column,
  .access--reload .access__column {
    animation: access-fade 200ms linear both;
  }

  .access__value--fresh::after,
  .access__pulse {
    animation: none;
  }

  .access__pulse {
    display: none;
  }
}
</style>
