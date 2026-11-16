<script setup lang="ts">
import { motion } from 'motion-v'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router'

import { isFirstNavigation } from '@/app/router'
import { maskSpeech, maskText, type CodeSession } from '@/features/access/access'
import MotionToggle from '@/features/home/MotionToggle.vue'
import { profileFingerprint } from '@/features/intake/checkStamp'
import { useIntakeDraft } from '@/features/intake/draft'
import { ACCESS_ROUTE, REVIEW_ROUTE } from '@/features/intake/guard'
import { intakeSteps, stepScene } from '@/features/intake/steps'
import { intakeExit } from '@/motion/presets'
import { useSceneStore } from '@/scene/sceneStore'
import CosmosIcon from '@/ui/CosmosIcon.vue'
import PrimaryCTA from '@/ui/PrimaryCTA.vue'
import ProgressStep from '@/ui/ProgressStep.vue'

import {
  clearAttempt,
  consentTexts,
  creationMode,
  loadSetup,
  openAttempt,
  orderSubject,
  OrderRefused,
  placeOrder,
  readConfig,
  recoverOrderId,
  renewAttempt,
  type ConfigRead,
  type CreationMode,
  type OrderAttempt,
  type OrderFailure,
} from './consent'

// SCR-05, slice 6: the quiet pause before the irreversible step. The scene
// keeps the access frame (К12) and does not react to anything here (M06).
// Real creation is shut until Q12 (owner decisions 3–5): the only mode that
// sends `POST /orders` is `test`, which exists in a development build served
// by MSW and in no production bundle.

type Load = 'checking' | 'ready' | 'failed'
type Action = 'idle' | 'submitting' | 'recovering'
type Notice = { kind: OrderFailure['kind']; text: string }

/** A quick answer changes nothing on screen; only a slow one shows its status line. */
const SLOW_MS = 300

// Dev builds only: `import.meta.env.DEV` is a compile-time constant, so the
// dead branch (and the chunks of both components) never reach production.
const TestBanner = import.meta.env.DEV ? defineAsyncComponent(() => import('./TestModeBanner.vue')) : null
const ConsentText = import.meta.env.DEV ? defineAsyncComponent(() => import('./TestConsentText.vue')) : null

const router = useRouter()
const intake = useIntakeDraft()
const scene = useSceneStore()
const firstLoad = isFirstNavigation(router)

/** Taken once: the guard let a complete, checked draft in, and leaving the draft cleared must not blank the exit. */
const subject = orderSubject(intake.draft)

const heading = useTemplateRef<HTMLElement>('heading')
const cta = useTemplateRef<InstanceType<typeof PrimaryCTA>>('cta')
const checkbox = useTemplateRef<HTMLInputElement>('checkbox')
const statusBox = useTemplateRef<HTMLElement>('statusBox')

const load = ref<Load>('checking')
const mode = ref<CreationMode | null>(null)
const session = ref<CodeSession | null>(null)
const consentVersion = ref('')
const attempt = ref<OrderAttempt | null>(null)
const consented = ref(false)
const action = ref<Action>('idle')
const notice = ref<Notice | null>(null)
/** A reason creation cannot go on, shown in place of the confirmation (К11, blocked, used). */
const halt = ref<string | null>(null)
/** The order the access already made: «Открыть разбор». */
const usedOrderId = ref<string | null>(null)
const slow = ref(false)
const checkSlow = ref(false)
const locked = ref(false)

const mask = computed(() => session.value?.entitlement.code_mask ?? '')
/** «Код, оканчивающийся на 7 K 2 Q» for a screen reader; the dots are not read. */
const maskSpoken = computed(() => maskSpeech(mask.value).replace(/^./, (first) => first.toUpperCase()))
const busy = computed(() => action.value !== 'idle')
const checking = computed(() => load.value === 'checking')

const unavailable = computed(() => {
  if (load.value === 'failed') return consentTexts.configError
  if (halt.value) return halt.value
  if (mode.value === 'blocked') return consentTexts.blocked
  if (mode.value === 'generation_off') return consentTexts.generationOff
  return null
})

type SlotKind = 'reserve' | 'unavailable' | 'confirm'
const slotKind = computed<SlotKind>(() => {
  if (checking.value) return 'reserve'
  return unavailable.value ? 'unavailable' : 'confirm'
})

const label = computed(() => {
  if (usedOrderId.value) return 'Открыть разбор'
  if (load.value === 'failed' || notice.value?.kind === 'unknown') return 'Проверить ещё раз'
  return 'Создать мой разбор'
})

const inactive = computed(() => {
  if (busy.value) return true
  if (usedOrderId.value || load.value === 'failed') return false
  if (load.value !== 'ready' || mode.value !== 'test' || halt.value !== null || locked.value) return true
  return !consented.value
})

/** Dim a quick check or request only once it is slow, so a fast answer does not flicker. */
const dimmed = computed(() => inactive.value && !(busy.value && !slow.value) && !(checking.value && !checkSlow.value))

const describedBy = computed(() => {
  if (notice.value) return 'consent-notice'
  if (unavailable.value) return 'consent-unavailable'
  return inactive.value && slotKind.value === 'confirm' ? 'consent-reason' : undefined
})

const status = computed(() => {
  if (action.value === 'recovering') return consentTexts.recovering
  if (action.value === 'submitting' && slow.value) return consentTexts.submitting
  if (checking.value && checkSlow.value) return consentTexts.checking
  return null
})

/** Same line as the review: the lowest point of the planet over the intake frames. */
const clearY = computed(() => Math.max(0, ...intakeSteps.map((s) => {
  const frame = scene.frameFor(stepScene(s))
  return frame ? frame.planet.y + frame.planet.r : 0
})))

/** «Создать» and «Открыть разбор» leave to the left, «Назад» and «Изменить» to the right (SCR-05 §2). */
const exitX = ref<number>(intakeExit.x)
const exitMotion = computed(() => ({ ...intakeExit, x: exitX.value }))

let setupController: AbortController | null = null
let orderController: AbortController | null = null
let slowTimer: ReturnType<typeof setTimeout> | undefined
let checkTimer: ReturnType<typeof setTimeout> | undefined
let lockTimer: ReturnType<typeof setTimeout> | undefined
/** The screen is going away (success, redirect): nothing may be switched back on. */
let leaving = false
let fingerprint = ''

/** Read again after an await: the screen may have left, or a refusal may have set a notice, meanwhile. */
const gone = (signal: AbortSignal) => signal.aborted
const hasNotice = () => notice.value !== null

function focusCta() {
  ;(cta.value?.$el as HTMLElement | undefined)?.focus()
}

/** An error and its button are brought into view only when they are not (§0.11). */
function reveal() {
  const box = statusBox.value
  if (!box) return
  const { top, bottom } = box.getBoundingClientRect()
  if (top < 0 || bottom > window.innerHeight) box.scrollIntoView({ block: 'center' })
}

function lock(seconds: number) {
  locked.value = true
  clearTimeout(lockTimer)
  lockTimer = setTimeout(() => {
    locked.value = false
    notice.value = null
  }, seconds * 1000)
}

function leave(location: RouteLocationRaw, toTheLeft: boolean, replace = false) {
  leaving = true
  exitX.value = toTheLeft ? -intakeExit.x : intakeExit.x
  return replace ? router.replace(location) : router.push(location)
}

/** §0.3: the mode of this visit, and the attempt that goes with it (§0.7). */
function applyConfig({ config, mocked }: ConfigRead, renew: boolean) {
  consentVersion.value = config.consent_version
  mode.value = creationMode({ config, mocked, devBuild: import.meta.env.DEV })
  const entitlementId = session.value?.entitlement.id
  if (mode.value !== 'test' || !entitlementId) {
    attempt.value = null
    return
  }
  const scope = { entitlementId, fingerprint, consentVersion: config.consent_version }
  attempt.value = renew ? renewAttempt(scope) : openAttempt(scope)
}

async function check() {
  setupController?.abort()
  const current = new AbortController()
  setupController = current
  load.value = 'checking'
  checkSlow.value = false
  notice.value = null
  halt.value = null
  usedOrderId.value = null
  consented.value = false
  clearTimeout(checkTimer)
  checkTimer = setTimeout(() => (checkSlow.value = true), SLOW_MS)
  const setup = await loadSetup(current.signal)
  clearTimeout(checkTimer)
  if (current.signal.aborted) return
  checkSlow.value = false
  if (setup.kind === 'signed_out') {
    await leave({ name: ACCESS_ROUTE }, false, true)
    return
  }
  if (setup.kind === 'ordered') {
    await leave({ name: 'order', params: { id: setup.orderId } }, true, true)
    return
  }
  if (setup.kind === 'failed' || !subject) {
    load.value = 'failed'
    return
  }
  try {
    fingerprint = await profileFingerprint(subject.profile)
  } catch {
    load.value = 'failed'
    return
  }
  if (gone(current.signal)) return
  session.value = setup.session
  applyConfig(setup, false)
  load.value = 'ready'
}

async function openOrder(orderId: string) {
  await leave({ name: 'order', params: { id: orderId } }, true)
}

/** The server created the order for this access: it is confirmed, so the draft and the key are done (§0.7). */
async function complete(orderId: string) {
  clearAttempt()
  intake.reset()
  await leave({ name: 'order-creating', params: { id: orderId } }, true)
}

async function recover(signal: AbortSignal) {
  action.value = 'recovering'
  const entitlementId = session.value?.entitlement.id
  const orderId = entitlementId ? await recoverOrderId(entitlementId, signal) : null
  if (signal.aborted) return
  if (orderId) {
    await complete(orderId)
    return
  }
  // Same attempt, same key: the retry can only return the order or create it once.
  notice.value = { kind: 'unknown', text: consentTexts.unknown }
}

async function outdated(signal: AbortSignal) {
  consented.value = false
  const fresh = await readConfig()
  if (signal.aborted) return
  if (!fresh) {
    load.value = 'failed'
    return
  }
  applyConfig(fresh, true)
  if (mode.value !== 'test') return
  notice.value = { kind: 'consent_outdated', text: consentTexts.consentOutdated }
  await nextTick()
  checkbox.value?.focus()
}

async function alreadyOrdered(signal: AbortSignal) {
  consented.value = false
  const entitlementId = session.value?.entitlement.id
  usedOrderId.value = entitlementId ? await recoverOrderId(entitlementId, signal) : null
  if (signal.aborted) return
  halt.value = consentTexts.entitlementUsed
  await nextTick()
  focusCta()
}

/** What each refusal leaves on screen (§0.8). The draft and the code session are never touched. */
async function settle(failure: OrderFailure, signal: AbortSignal) {
  switch (failure.kind) {
    case 'unknown':
      await recover(signal)
      if (!hasNotice()) return
      break
    case 'signed_out':
      await leave({ name: ACCESS_ROUTE }, false, true)
      return
    case 'unavailable':
      mode.value = 'blocked'
      attempt.value = null
      consented.value = false
      return
    case 'consent_outdated':
      await outdated(signal)
      return
    case 'entitlement_used':
      await alreadyOrdered(signal)
      return
    case 'entitlement_blocked':
      consented.value = false
      halt.value = consentTexts.entitlementBlocked
      return
    case 'stale':
      await check()
      return
    case 'key_reused':
      if (attempt.value) attempt.value = renewAttempt(attempt.value)
      notice.value = { kind: failure.kind, text: consentTexts.failed }
      break
    case 'calculation_failed':
      notice.value = { kind: failure.kind, text: consentTexts.calculationFailed }
      break
    case 'limited':
      notice.value = { kind: failure.kind, text: failure.message }
      if (failure.retryAfter) lock(failure.retryAfter)
      break
    case 'fix_profile':
    case 'failed':
      notice.value = { kind: failure.kind, text: failure.message }
  }
  await nextTick()
  focusCta()
}

async function create() {
  const ticket = attempt.value
  if (!ticket || !subject || inactive.value) return
  // Synchronously, before anything is awaited: a second press finds the button inactive.
  action.value = 'submitting'
  notice.value = null
  slow.value = false
  clearTimeout(slowTimer)
  slowTimer = setTimeout(() => (slow.value = true), SLOW_MS)
  const current = new AbortController()
  orderController = current
  try {
    await complete(
      await placeOrder(
        { key: ticket.key, entitlementId: ticket.entitlementId, profile: subject.profile, consentVersion: ticket.consentVersion },
        current.signal,
      ),
    )
  } catch (cause) {
    if (current.signal.aborted) return
    await settle(cause instanceof OrderRefused ? cause.failure : { kind: 'unknown' }, current.signal)
  } finally {
    if (!current.signal.aborted) {
      clearTimeout(slowTimer)
      // On the way out the screen stays as it is: inactive, with its status line.
      if (!leaving) {
        slow.value = false
        action.value = 'idle'
      }
    }
  }
  if (hasNotice()) {
    await nextTick()
    reveal()
  }
}

function primary() {
  if (inactive.value) return
  if (usedOrderId.value) {
    void openOrder(usedOrderId.value)
    return
  }
  if (load.value === 'failed') {
    void check()
    return
  }
  void create()
}

function onCheckboxClick(event: MouseEvent) {
  if (busy.value) event.preventDefault()
}

function onCheckboxChange(event: Event) {
  if (busy.value) return
  consented.value = (event.target as HTMLInputElement).checked
}

function edit() {
  if (busy.value) return
  void leave({ name: REVIEW_ROUTE }, false)
}

function back() {
  if (busy.value) return
  const location = { name: ACCESS_ROUTE }
  if (router.options.history.state.back === router.resolve(location).fullPath) {
    exitX.value = intakeExit.x
    router.back()
    return
  }
  void leave(location, false)
}

onMounted(() => {
  window.scrollTo({ top: 0 })
  heading.value?.focus({ preventScroll: true })
  if (!subject) {
    // The guard keeps this from happening; if it does, the review reads the draft again.
    void leave({ name: REVIEW_ROUTE }, false, true)
    return
  }
  void check()
})

onBeforeUnmount(() => {
  setupController?.abort()
  orderController?.abort()
  clearTimeout(slowTimer)
  clearTimeout(checkTimer)
  clearTimeout(lockTimer)
})
</script>

<template>
  <motion.main
    id="main"
    class="consent"
    :class="{ 'consent--reload': firstLoad }"
    :initial="false"
    :animate="{ opacity: 1 }"
    :exit="exitMotion"
    :style="{ '--intake-clear-y': `${clearY}px` }"
  >
    <header class="consent__top">
      <RouterLink class="consent__link" to="/">
        <CosmosIcon class="consent__link-icon" name="arrow-left" />
        <span>На главную</span>
      </RouterLink>
    </header>

    <div class="consent__column">
      <ProgressStep class="consent__progress" :current="intakeSteps.length" :total="intakeSteps.length" done />

      <component :is="TestBanner" v-if="TestBanner && mode === 'test'" />

      <h1 ref="heading" class="consent__title" tabindex="-1">
        <span class="consent__title-line">Последний шаг</span>
        <span class="consent__title-accent">перед твоим разбором.</span>
      </h1>
      <p class="consent__lead">Ещё раз взгляни на данные и доступ. После подтверждения начнётся создание разбора.</p>

      <form class="consent__form" novalidate @submit.prevent="primary">
        <dl class="consent__list">
          <div class="consent__item" data-block="profile">
            <dt class="consent__label">Анкета</dt>
            <dd class="consent__edit">
              <button
                class="consent__edit-button"
                type="button"
                aria-label="Изменить данные анкеты"
                :aria-disabled="busy ? 'true' : undefined"
                @click="edit"
              >
                Изменить
              </button>
            </dd>
            <dd class="consent__value">{{ subject?.summary.name }}</dd>
            <dd class="consent__note">{{ subject?.summary.details }}</dd>
          </div>
          <div class="consent__item" data-block="access">
            <dt class="consent__label">Доступ</dt>
            <dd class="consent__value consent__value--code">
              <template v-if="mask">
                <span aria-hidden="true">Код {{ maskText(mask) }}</span>
                <span class="visually-hidden">{{ maskSpoken }}</span>
              </template>
            </dd>
          </div>
        </dl>

        <div class="consent__slot">
          <div :key="slotKind" class="consent__state" :data-slot="slotKind">
            <template v-if="slotKind === 'confirm'">
              <p id="consent-cost" class="consent__cost">{{ consentTexts.cost }}</p>
              <div class="consent__check">
                <span class="consent__control">
                  <input
                    id="consent-check"
                    ref="checkbox"
                    class="consent__input"
                    type="checkbox"
                    :checked="consented"
                    :aria-disabled="busy ? 'true' : undefined"
                    aria-describedby="consent-cost"
                    @click="onCheckboxClick"
                    @change="onCheckboxChange"
                  />
                  <span class="consent__box" aria-hidden="true">
                    <CosmosIcon class="consent__tick" name="check" />
                  </span>
                </span>
                <!-- The wording is a slot for the text approved under Q12; until then only the stand fills it. -->
                <label class="consent__check-label" for="consent-check">
                  <component :is="ConsentText" v-if="ConsentText" />
                </label>
              </div>
              <span id="consent-reason" class="visually-hidden">{{ consentTexts.needConsent }}</span>
            </template>
            <p v-else-if="slotKind === 'unavailable'" id="consent-unavailable" class="consent__unavailable">{{ unavailable }}</p>
          </div>
        </div>

        <div class="consent__actions">
          <PrimaryCTA
            ref="cta"
            class="consent__next"
            :class="{ 'is-dimmed': dimmed }"
            :aria-disabled="inactive ? 'true' : undefined"
            :aria-describedby="describedBy"
          >
            {{ label }}
          </PrimaryCTA>
          <button class="consent__link" type="button" :aria-disabled="busy ? 'true' : undefined" @click="back">
            <CosmosIcon class="consent__link-icon" name="arrow-left" />
            <span>Назад</span>
          </button>
        </div>

        <div ref="statusBox" class="consent__status">
          <p class="consent__status-text" role="status">
            <template v-if="status">
              <span class="consent__pulse" aria-hidden="true" />
              <span>{{ status }}</span>
            </template>
            <span v-else-if="notice" id="consent-notice" :key="`${notice.kind}:${notice.text}`" class="consent__notice">{{ notice.text }}</span>
          </p>
          <button v-if="notice?.kind === 'fix_profile'" class="consent__fix" type="button" @click="edit">Проверить и изменить</button>
        </div>
      </form>
    </div>

    <footer class="consent__foot">
      <p class="consent__privacy">Ответы хранятся только в этой вкладке.</p>
      <MotionToggle class="consent__toggle" />
    </footer>
  </motion.main>
</template>

<style scoped>
/* Page frame: the same as the review and the access, so the column does not move between SCR-03, 04 and 05. */
.consent {
  --u: var(--scene-u, 1px);
  position: relative;
  z-index: var(--cosmos-z-content);
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  padding: 0 var(--cosmos-page-gutter);
  overflow-x: clip;
}

.consent__top {
  display: flex;
  align-items: center;
  min-height: 64px;
}

.consent__link {
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

.consent__link[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}

.consent__link-icon {
  font-size: 18px;
  transition: transform var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.consent__column {
  width: 100%;
  max-width: 560px;
  padding-top: max(12px, calc(20svh - 64px), calc(var(--intake-clear-y, 0px) - 72px));
}

@media (min-aspect-ratio: 6/5) and (max-width: 959px), (min-aspect-ratio: 6/5) and (max-height: 599px) {
  .consent::before {
    position: fixed;
    inset: 0;
    z-index: -1;
    background: linear-gradient(to right, rgba(7, 17, 29, .88), rgba(7, 17, 29, .7) 55%, rgba(7, 17, 29, 0));
    content: "";
    pointer-events: none;
  }

  .consent__column {
    padding-top: 12px;
  }
}

.consent__progress {
  margin-bottom: 16px;
}

.consent__title {
  margin: 0;
  color: #f6f4ef;
  font-size: clamp(32px, 8.6vw, 36px);
  font-weight: 300;
  letter-spacing: -0.025em;
  line-height: 1.02;
}

.consent__title:focus {
  outline: none;
}

.consent__title-line,
.consent__title-accent {
  display: block;
}

.consent__title-accent {
  color: var(--cosmos-gold-pale);
  font-family: var(--cosmos-font-serif);
  font-size: 1.078em;
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.2;
  text-wrap: balance;
}

.consent__lead {
  max-width: 44ch;
  margin: 10px 0 0;
  color: var(--cosmos-muted);
  font-size: 16px;
  line-height: 1.5;
  text-wrap: pretty;
}

.consent__form {
  margin-top: 28px;
}

/* The two blocks of the review on their underlines; both have their final height from the first frame (§0.11). */
.consent__list {
  display: grid;
  gap: 20px;
  margin: 0;
}

.consent__item {
  display: grid;
  grid-template-areas:
    "label edit"
    "value value"
    "note note";
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 16px;
  align-items: center;
}

.consent__label {
  grid-area: label;
  color: #a3a7b0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: var(--cosmos-tracking-micro);
  line-height: 1;
  text-transform: uppercase;
}

.consent__value {
  position: relative;
  grid-area: value;
  min-height: 46px;
  margin: 0;
  padding: 8px 0 10px;
  color: var(--cosmos-text);
  font-size: 24px;
  font-weight: 300;
  letter-spacing: -0.01em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.consent__value::before {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: rgba(225, 218, 207, .32);
  content: "";
  pointer-events: none;
}

.consent__value--code {
  font-size: 20px;
}

.consent__note {
  grid-area: note;
  min-height: 1.45em;
  margin: 8px 0 0;
  color: var(--cosmos-faint);
  font-size: 15px;
  line-height: 1.45;
  text-wrap: pretty;
}

.consent__edit {
  grid-area: edit;
  justify-self: end;
  margin: 0;
}

/* 44px target around a small word; negative margins keep the label row thin. */
.consent__edit-button,
.consent__fix {
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

.consent__edit-button {
  min-width: var(--cosmos-target-min);
  min-height: var(--cosmos-target-min);
  margin-block: -16px;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.consent__edit-button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}

.consent__fix {
  min-height: var(--cosmos-target-min);
  font-size: 14px;
}

/* The confirmation keeps its height while the mode is read and when it is replaced by a message (§0.11). */
.consent__slot {
  min-height: 92px;
  margin-top: 24px;
}

.consent__state {
  animation: consent-fade var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.consent__cost {
  margin: 0;
  color: var(--cosmos-gold-light);
  font-size: 15px;
  line-height: 1.45;
  text-wrap: pretty;
}

.consent__unavailable {
  max-width: 44ch;
  margin: 0;
  color: var(--cosmos-muted);
  font-size: 15px;
  line-height: 1.45;
  text-wrap: pretty;
}

.consent__check {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}

/* The native checkbox fills the 44px target and stays under the drawn box. */
.consent__control {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: var(--cosmos-target-min);
  height: var(--cosmos-target-min);
}

.consent__input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.consent__input[aria-disabled='true'] {
  cursor: default;
}

.consent__box {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(225, 218, 207, .55);
  border-radius: var(--cosmos-radius-sm);
  color: var(--cosmos-gold-light);
  transition:
    border-color var(--cosmos-dur-micro) var(--cosmos-ease-out),
    background-color var(--cosmos-dur-micro) var(--cosmos-ease-out);
  pointer-events: none;
}

.consent__tick {
  font-size: 18px;
  clip-path: inset(0 100% 0 0);
  transition: clip-path var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.consent__input:checked + .consent__box {
  border-color: var(--cosmos-gold);
  background: rgba(200, 170, 119, .16);
}

.consent__input:checked + .consent__box .consent__tick {
  clip-path: inset(0);
}

.consent__input:focus-visible + .consent__box {
  outline: 2px solid var(--cosmos-focus);
  outline-offset: 3px;
}

.consent__check-label {
  min-width: 0;
  color: var(--cosmos-text);
  font-size: 16px;
  line-height: 1.45;
  text-wrap: pretty;
}

.consent__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 28px;
  margin-top: 20px;
}

.consent__next {
  --cta-width: min(100%, 260px);
  transition: opacity var(--cosmos-dur-micro) var(--cosmos-ease-out);
}

.consent__next.is-dimmed {
  opacity: 0.5;
  cursor: default;
}

/* The status and the errors share one line under the buttons, so the buttons never move. */
.consent__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 20px;
  min-height: 24px;
  margin-top: 14px;
}

.consent__status-text {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--cosmos-muted);
  font-size: 15px;
  line-height: 1.45;
  text-wrap: pretty;
}

.consent__status-text > * {
  animation: consent-note-in var(--cosmos-dur-micro) var(--cosmos-ease-out) both;
}

.consent__notice {
  max-width: 48ch;
}

/* «Создаём заказ…»: the thin running line of the review. */
.consent__pulse {
  position: relative;
  flex: none;
  width: 28px;
  height: 1px;
  overflow: hidden;
  background: rgba(225, 218, 207, .2);
}

.consent__pulse::after {
  position: absolute;
  inset: 0;
  background: var(--cosmos-gold-pale);
  animation: consent-pulse 1.1s var(--cosmos-ease-in-out) infinite;
  content: "";
}

.consent__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-top: auto;
  padding: 40px 0 max(20px, env(safe-area-inset-bottom));
}

.consent__privacy {
  margin: 0;
  color: var(--cosmos-faint);
  font-size: 13px;
  line-height: 1.45;
}

@media (hover: hover) and (pointer: fine) {
  .consent__link:not([aria-disabled='true']):hover {
    color: var(--cosmos-text);
  }

  .consent__link:not([aria-disabled='true']):hover .consent__link-icon {
    transform: translateX(-3px);
  }

  .consent__edit-button:not([aria-disabled='true']):hover,
  .consent__fix:hover {
    text-decoration-color: currentColor;
  }

  .consent__input:not([aria-disabled='true']):hover + .consent__box {
    border-color: var(--cosmos-gold-light);
  }
}

/* Reference layout: the column on the hero's text line, the planet keeps the right. */
@media (min-width: 960px) and (min-height: 600px) and (min-aspect-ratio: 6/5) {
  .consent {
    padding: 0 calc(73 * var(--u)) 0 calc(74.5 * var(--u));
  }

  .consent__top {
    min-height: calc(110 * var(--u));
  }

  .consent__column {
    max-width: min(560px, calc(560 * var(--u)));
    padding-top: calc(48 * var(--u));
  }

  .consent__progress {
    margin-bottom: calc(34 * var(--u));
  }

  .consent__title {
    font-size: clamp(40px, calc(52 * var(--u)), 60px);
  }

  .consent__lead {
    margin-top: calc(14 * var(--u));
    font-size: max(16px, calc(17 * var(--u)));
  }

  .consent__form {
    margin-top: calc(32 * var(--u));
  }

  .consent__list {
    gap: calc(22 * var(--u));
  }

  .consent__value {
    font-size: 28px;
  }

  .consent__value--code {
    font-size: 22px;
  }

  .consent__next {
    --cta-width: calc(260 * var(--u));
    --cta-height: calc(58 * var(--u));
    --cta-padding-x: calc(24.5 * var(--u));
    --cta-padding-right: calc(21 * var(--u));
    --cta-font: max(14px, calc(15 * var(--u)));
  }

  .consent__foot {
    min-height: calc(110 * var(--u));
    padding: 32px 0 24px;
  }

  .consent__toggle {
    --toggle-ring: calc(37 * var(--u));
    --toggle-gap: calc(14 * var(--u));
    --toggle-font: max(11px, calc(11.5 * var(--u)));
  }
}

/*
 * Entrance (SCR-05 §2): from the access the column slides in from the right
 * as one layer; on a reload it rises like the others. The summary is
 * readable from the first frame.
 */
.consent__column {
  animation: consent-slide var(--cosmos-dur-step-enter) var(--cosmos-ease-out) 80ms both;
}

.consent--reload .consent__column {
  animation: consent-rise 600ms var(--cosmos-ease-out) 60ms both;
}

.consent__top,
.consent__foot {
  animation: consent-fade var(--cosmos-dur-step-enter) var(--cosmos-ease-out) both;
}

@keyframes consent-slide {
  from {
    opacity: 0;
    filter: blur(2px);
    transform: translateX(20px);
  }
}

@keyframes consent-rise {
  from {
    opacity: 0;
    filter: blur(6px);
    transform: translateY(12px);
  }
}

@keyframes consent-fade {
  from {
    opacity: 0;
  }
}

@keyframes consent-note-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

@keyframes consent-pulse {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

/* M06 under reduced motion: opacity only, a static line instead of the running one, a tick without drawing. */
@media (prefers-reduced-motion: reduce) {
  .consent__column,
  .consent--reload .consent__column {
    animation: consent-fade 200ms linear both;
  }

  .consent__status-text > * {
    animation-name: consent-fade;
  }

  .consent__pulse {
    display: none;
  }

  .consent__tick,
  .consent__box,
  .consent__next {
    transition: none;
  }
}
</style>
