<script setup lang="ts">
import { motion } from 'motion-v'
import { computed, useTemplateRef } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { isFirstNavigation } from '@/app/router'
import { useRouteFocus } from '@/app/useRouteFocus'
import { heroExit, heroReturn, routeFade } from '@/motion/presets'
import { compositions } from '@/scene/compositions'
import { plates } from '@/scene/plates'
import SceneGround from '@/scene/SceneGround.vue'
import { useSceneStore } from '@/scene/sceneStore'
import CosmosIcon from '@/ui/CosmosIcon.vue'
import PrimaryCTA from '@/ui/PrimaryCTA.vue'
import SecondaryCTA from '@/ui/SecondaryCTA.vue'

import MotionToggle from './MotionToggle.vue'

// SCR-01. Composition, copy and proportions follow
// docs/frontend/references/hero-approved.png; measurements and deviations
// are in docs/frontend/screens/SCR-01.md. The planet, orbits and sky belong
// to CosmosCanvas; this view only lays text over them, reading the planet
// geometry from the --planet-* variables the scene publishes.

const heading = useTemplateRef<HTMLElement>('heading')
useRouteFocus(heading)

// M01 is the entrance of the first visit only, with no route fade on top to
// delay the heading. Later visits come back calmly as one layer (heroReturn).
const firstVisit = isFirstNavigation(useRouter())
const routeInitial = firstVisit ? false : heroReturn.initial
const routeAnimate = firstVisit ? routeFade.animate : heroReturn.animate

const scene = useSceneStore()

// Portrait (owner decision, variant B): the horizon band closes the page and
// the infinity caption and the strip sit on it; --ground-water is its
// waterline from the top of the band. Read from the hero composition, not
// the active one: while the hero leaves, the camera already flies on.
const ground = computed(() => {
  const composition = compositions.hero[scene.orientation]
  const frame = scene.frameFor('hero')
  const plate = plates[composition.plate]
  if (!frame || composition.ground !== 'page') return null
  return { frame, composition, water: (plate.horizonY - plate.groundTop) * frame.scale }
})
</script>

<template>
  <motion.main
    id="main"
    class="home"
    :class="{ 'home--ground': ground, 'home--return': !firstVisit }"
    :initial="routeInitial"
    :animate="routeAnimate"
    :exit="heroExit"
  >
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero__copy">
        <p class="hero__eyebrow" data-hero-part style="--i: 2">
          <CosmosIcon class="hero__eyebrow-star" name="sparkle" />
          <span>Искусство узнавать себя</span>
        </p>
        <h1 id="hero-title" ref="heading" class="hero__title" tabindex="-1">
          <span class="hero__title-line" data-hero-part style="--i: 0">У каждого —</span>
          <span class="hero__title-accent" data-hero-part style="--i: 1">свой космос.</span>
        </h1>
        <p class="hero__lead" data-hero-part style="--i: 3">
          <span class="hero__lead-line">В момент твоего рождения звёзды сложились</span>
          {{ ' ' }}
          <span class="hero__lead-line">в неповторимую историю. Познакомься со своей.</span>
        </p>
        <div class="hero__actions" data-hero-part style="--i: 4">
          <PrimaryCTA class="hero__primary" to="/create">Построить мою карту</PrimaryCTA>
          <SecondaryCTA class="hero__secondary" to="/example">Смотреть пример</SecondaryCTA>
        </div>
        <p class="hero__note" data-hero-part style="--i: 5">Твоя дата. Твоё место. Твоя вселенная.</p>
        <p class="hero__access" data-hero-part style="--i: 6">
          <RouterLink class="hero__access-link" to="/login">Войти</RouterLink>
          <RouterLink class="hero__access-link" to="/activate">Есть код активации</RouterLink>
        </p>
      </div>

      <div class="hero__captions" aria-hidden="true" data-hero-ambient>
        <div class="hero__origin">
          <CosmosIcon class="hero__origin-mark" name="plus" />
          <p class="hero__origin-text">У каждой истории<br />есть точка отсчёта</p>
        </div>
        <p class="hero__vertical" lang="en">As above · so within</p>
      </div>
    </section>

    <div class="hero__ground" :style="ground ? { '--ground-water': `${String(ground.water)}px` } : undefined">
      <SceneGround v-if="ground" class="hero__ground-band" :frame="ground.frame" :composition="ground.composition" :drift="!scene.motionPaused" />
      <div class="hero__infinity" aria-hidden="true" data-hero-ambient>
        <span class="hero__infinity-pointer" />
        <p class="hero__infinity-title">Бесконечность</p>
        <p class="hero__infinity-accent">начинается внутри</p>
      </div>
      <div class="hero__strip" data-hero-ambient>
        <p class="hero__count" aria-hidden="true">01 <span class="hero__count-slash">/</span> ∞</p>
        <div class="hero__strip-divider" aria-hidden="true" />
        <div class="hero__tagline">
          <p class="hero__tagline-lead">Ближе к себе. Дальше привычного.</p>
          <p class="hero__tagline-sub">Натальная карта · Личный разбор · Новый взгляд</p>
        </div>
        <div class="hero__whole">
          <CosmosIcon class="hero__whole-star" name="sparkle-outline" />
          <p class="hero__whole-text">Целая вселенная.<br />И всё это — ты.</p>
        </div>
        <MotionToggle class="hero__toggle" />
      </div>
    </div>
  </motion.main>
</template>

<style scoped>
/*
 * Mobile-first stacked layout; the reference composition proper starts at
 * the desktop query below. Desktop sizes are written in reference pixels
 * times --u (one CSS pixel of the 1440×873 reference frame, published by
 * CosmosCanvas), so the text keeps its place against the planet.
 */
.home {
  --u: var(--scene-u, 1px);
  position: relative;
  z-index: var(--cosmos-z-content);
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  overflow-x: clip;
}

.hero {
  position: relative;
}

/* Keeps the stacked copy readable over the lower limb of the planet and the horizon. */
.home::before {
  position: absolute;
  inset: calc(var(--planet-y, 196px) + var(--planet-r, 187px) * 0.55) 0 0;
  z-index: -1;
  background: linear-gradient(to bottom, rgba(7, 17, 29, 0), rgba(7, 17, 29, .78) 22rem, rgba(7, 17, 29, .9));
  content: "";
  pointer-events: none;
}

.hero__copy {
  position: relative;
  padding: calc(var(--planet-y, 196px) + var(--planet-r, 187px) * 0.92) var(--cosmos-page-gutter) 0;
}

.hero__eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  color: #a3a7b0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: var(--cosmos-tracking-micro);
  line-height: 1;
  text-transform: uppercase;
}

.hero__eyebrow-star {
  width: 10px;
  height: 10px;
  color: var(--cosmos-gold-pale);
}

.hero__title {
  margin: 20px 0 0;
  color: #f6f4ef;
  font-size: var(--cosmos-text-hero-mobile);
  font-weight: 300;
  letter-spacing: -0.025em;
  line-height: 1;
}

.hero__title:focus {
  outline: none;
}

.hero__title-line,
.hero__title-accent {
  display: block;
}

.hero__title-accent {
  color: var(--cosmos-gold-pale);
  font-family: var(--cosmos-font-serif);
  font-size: 1.078em;
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.hero__lead {
  max-width: 36ch;
  margin: 16px 0 0;
  color: var(--cosmos-muted);
  font-size: 16px;
  line-height: 1.65;
  text-wrap: pretty;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 22px;
  margin-top: 28px;
}

.hero__primary {
  --cta-width: min(100%, 260px);
}

.hero__note {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 0;
  color: #848c96;
  font-size: 12px;
  letter-spacing: 0.02em;
}

.hero__note::before {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  content: "";
}

/*
 * Owner decision for C20: the ways to the account and to code activation sit
 * under the note, set further off than the note is from the actions it belongs to.
 */
.hero__access {
  display: flex;
  flex-wrap: wrap;
  gap: 0 28px;
  margin: 14px 0 0;
  font-size: 13px;
  line-height: 1.3;
}

.hero__access-link {
  display: inline-flex;
  align-items: center;
  min-width: var(--cosmos-target-min);
  min-height: var(--cosmos-target-min);
  color: #b9bfc5;
  text-decoration: underline;
  text-decoration-color: rgba(185, 191, 197, .35);
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
  transition:
    color var(--cosmos-dur-micro) ease,
    text-decoration-color var(--cosmos-dur-micro) ease;
}

@media (hover: hover) and (pointer: fine) {
  .hero__access-link:hover {
    color: var(--cosmos-text);
    text-decoration-color: currentColor;
  }
}

.hero__captions,
.hero__infinity {
  display: none;
}

.hero__strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px 24px;
  margin: 48px var(--cosmos-page-gutter) 0;
  padding: 24px 0 28px;
  border-top: 1px solid rgba(225, 218, 207, .12);
}

.hero__count,
.hero__strip-divider {
  display: none;
}

.hero__tagline,
.hero__whole {
  flex: 1 1 100%;
}

.hero__tagline-lead,
.hero__tagline-sub,
.hero__whole-text {
  margin: 0;
}

.hero__tagline-lead {
  color: #cad0d4;
  font-size: 15px;
  line-height: 1.4;
}

.hero__tagline-sub {
  margin-top: 6px;
  color: #7a838d;
  font-size: 12px;
  letter-spacing: 0.02em;
}

.hero__whole {
  display: flex;
  align-items: center;
  gap: 14px;
}

.hero__whole-star {
  width: 22px;
  height: 22px;
  color: var(--cosmos-gold-pale);
}

.hero__whole-text {
  color: #949aa0;
  font-size: 12px;
  line-height: 1.6;
}

.hero__count-slash {
  margin: 0 0.95em;
  color: #7c848c;
}

/* The dark halo keeps the caption at 4.5:1 wherever the scene puts lit haze or rim light behind it. */
.hero__infinity {
  color: rgba(250, 241, 228, .94);
  text-shadow:
    0 0 2px rgba(7, 17, 29, .55),
    0 0 12px rgba(7, 17, 29, .6);
}

.hero__infinity-title,
.hero__infinity-accent {
  margin: 0;
}

.hero__infinity-title {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.34em;
  text-transform: uppercase;
}

.hero__infinity-accent {
  margin-top: 2px;
  color: #fbe6d2;
  font-family: var(--cosmos-font-serif);
  font-size: 24px;
  font-style: italic;
  line-height: 1.1;
}

.hero__infinity-pointer {
  position: absolute;
  top: 6px;
  right: calc(100% + 12px);
  width: 52px;
  height: 1px;
  background: linear-gradient(to right, rgba(246, 232, 214, 0), rgba(246, 232, 214, .7));
}

.hero__infinity-pointer::after {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #f6ead8;
  content: "";
}

/*
 * Portrait composition (owner decision, variant B; SCR-01 journal, stage 7).
 * It reads top to bottom the way the reference reads left to right: the
 * planet, the copy in the open sky under it, then the horizon band closing
 * the page, with the infinity caption above the lit peaks and the strip on
 * the water. The scene fades its own plate out above the ground (ScenePoster).
 */
.home--ground::before {
  display: none;
}

.home--ground .hero {
  padding-bottom: 16px;
}

.home--ground .hero__copy {
  padding-top: calc(var(--planet-y, 188px) + var(--planet-r, 187px) + 6px);
}

.home--ground .hero__ground {
  position: relative;
  margin-top: auto;
  padding-top: calc(var(--ground-water) + 6px);
}

.hero__ground-band {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: -1;
}

.home--ground .hero__infinity {
  display: block;
  position: absolute;
  top: calc(var(--ground-water) * 0.12);
  right: var(--cosmos-page-gutter);
}

.home--ground .hero__strip {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px 16px;
  margin: 0 var(--cosmos-page-gutter);
  padding: 0 0 max(20px, env(safe-area-inset-bottom));
  border-top: 0;
}

.home--ground .hero__count {
  display: block;
  grid-row: 1;
  grid-column: 1;
  margin: 0;
  color: #969d9d;
  font-size: 12px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.home--ground .hero__toggle {
  grid-row: 1;
  grid-column: 2;
}

.home--ground .hero__tagline,
.home--ground .hero__whole {
  grid-column: 1 / -1;
}

/* Wide enough to keep the reference line breaks of the lead. */
@media (min-width: 600px) {
  .hero__lead {
    max-width: none;
  }

  .home--ground .hero__tagline {
    grid-column: 1;
  }

  .home--ground .hero__whole {
    grid-column: 2;
    justify-self: end;
  }

  .hero__lead-line {
    display: block;
  }
}

/*
 * Reference composition: planet on the right, copy column on the left.
 * Short or zoomed landscape viewports keep the stacked layout instead.
 */
@media (min-width: 960px) and (min-height: 600px) and (min-aspect-ratio: 6/5) {
  .home {
    height: 100svh;
    min-height: 600px;
  }

  .hero {
    position: static;
  }

  .hero__copy {
    position: absolute;
    top: calc(121.5 * var(--u));
    left: calc(74.5 * var(--u));
    padding: 0;
  }

  .home::before {
    display: none;
  }

  .hero__eyebrow {
    gap: calc(13 * var(--u));
    margin-left: calc(1 * var(--u));
    font-size: max(11px, calc(10.5 * var(--u)));
    letter-spacing: 0.17em;
  }

  .hero__eyebrow-star {
    width: calc(10 * var(--u));
    height: calc(10 * var(--u));
  }

  /* Manrope is wider than the reference face: 92u matches the reference line length, not its cap height. */
  .hero__title {
    margin-top: calc(47.3 * var(--u));
    font-size: clamp(60px, calc(92 * var(--u)), 112px);
    letter-spacing: -0.03em;
  }

  .hero__title-accent {
    line-height: 1.3;
  }

  .hero__lead {
    max-width: none;
    margin-top: calc(15 * var(--u));
    font-size: max(15px, calc(16 * var(--u)));
    line-height: 1.775;
  }

  .hero__lead-line {
    display: block;
  }

  .hero__actions {
    flex-wrap: nowrap;
    gap: calc(21 * var(--u));
    margin-top: calc(35 * var(--u));
  }

  .hero__primary {
    --cta-width: calc(239.5 * var(--u));
    --cta-height: calc(58 * var(--u));
    --cta-padding-x: calc(24.5 * var(--u));
    --cta-padding-right: calc(21 * var(--u));
    --cta-font: max(14px, calc(15 * var(--u)));
  }

  .hero__secondary {
    --secondary-ring: max(28px, calc(29 * var(--u)));
    --secondary-gap: calc(19 * var(--u));
    --secondary-font: max(13px, calc(14 * var(--u)));
  }

  .hero__note {
    gap: calc(10 * var(--u));
    margin-top: calc(22 * var(--u));
    font-size: max(12px, calc(12 * var(--u)));
  }

  .hero__access {
    gap: 0 calc(28 * var(--u));
    margin-top: calc(18 * var(--u));
    font-size: max(12px, calc(12.5 * var(--u)));
  }

  .hero__access-link {
    min-height: 24px;
  }

  .hero__ground {
    display: contents;
  }

  /*
   * Captions hang off the planet, in planet radii (SCR-01 journal, stage 3).
   * The dark halo keeps them at 4.5:1 where they cross the lit limb.
   */
  .hero__captions {
    display: block;
    position: absolute;
    inset: 0;
    color: rgba(250, 241, 228, .94);
    text-shadow:
      0 0 2px rgba(7, 17, 29, .55),
      0 0 12px rgba(7, 17, 29, .6);
    pointer-events: none;
  }

  .hero__origin {
    position: absolute;
    top: max(16px, calc(var(--planet-y) - 0.776 * var(--planet-r)));
    left: calc(var(--planet-x) + 0.257 * var(--planet-r));
    display: flex;
    align-items: center;
    gap: calc(0.058 * var(--planet-r));
  }

  .hero__origin-mark {
    width: calc(0.048 * var(--planet-r));
    height: calc(0.048 * var(--planet-r));
    color: rgba(246, 240, 230, .85);
  }

  .hero__origin-text,
  .hero__vertical {
    margin: 0;
    font-size: max(10px, calc(0.031 * var(--planet-r)));
    font-weight: 500;
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }

  .hero__origin-text {
    line-height: 2.05;
  }

  .hero__vertical {
    position: absolute;
    top: calc(var(--planet-y) + 0.248 * var(--planet-r));
    left: calc(var(--planet-x) + 0.978 * var(--planet-r));
    color: rgba(250, 241, 228, .86);
    letter-spacing: 0.42em;
    white-space: nowrap;
    writing-mode: vertical-rl;
    transform: translate(-50%, -50%);
  }

  .hero__infinity {
    display: block;
    position: absolute;
    top: calc(var(--planet-y) + 0.915 * var(--planet-r));
    left: calc(var(--planet-x) + 0.05 * var(--planet-r));
  }

  .hero__infinity-title {
    font-size: max(10px, calc(0.031 * var(--planet-r)));
  }

  .hero__infinity-accent {
    margin-top: calc(0.02 * var(--planet-r));
    font-size: max(24px, calc(0.082 * var(--planet-r)));
  }

  .hero__infinity-pointer {
    top: calc(0.087 * var(--planet-r));
    right: calc(100% + 0.065 * var(--planet-r));
    width: calc(0.26 * var(--planet-r));
  }

  .hero__strip {
    position: absolute;
    right: calc(73 * var(--u));
    bottom: 0;
    left: calc(72 * var(--u));
    flex-wrap: nowrap;
    gap: 0;
    height: calc(130 * var(--u));
    margin: 0;
    padding: 0;
  }

  .hero__count {
    display: block;
    margin: 0 0 0 calc(1 * var(--u));
    color: #969d9d;
    font-size: max(11px, calc(12.5 * var(--u)));
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  .hero__strip-divider {
    display: block;
    width: 1px;
    height: calc(42 * var(--u));
    margin: 0 calc(28 * var(--u)) 0 calc(30 * var(--u));
    background: rgba(225, 218, 207, .14);
  }

  .hero__tagline,
  .hero__whole {
    flex: none;
  }

  .hero__tagline-lead {
    font-size: max(13px, calc(15 * var(--u)));
    line-height: 1.3;
  }

  .hero__tagline-sub {
    margin-top: calc(9 * var(--u));
    font-size: max(11px, calc(11 * var(--u)));
  }

  .hero__whole {
    position: absolute;
    top: 50%;
    left: calc(634 * var(--u));
    gap: calc(16 * var(--u));
    transform: translateY(-50%);
  }

  .hero__whole-star {
    width: calc(24 * var(--u));
    height: calc(24 * var(--u));
  }

  .hero__whole-text {
    font-size: max(11px, calc(11.5 * var(--u)));
    line-height: 1.7;
  }

  .hero__toggle {
    --toggle-ring: calc(37 * var(--u));
    --toggle-gap: calc(14 * var(--u));
    --toggle-font: max(11px, calc(11.5 * var(--u)));
    margin-left: auto;
  }
}

/*
 * M01 (MOTION_SPEC §4): the heading gathers out of the scene first, the
 * rest of the copy follows; captions and the strip only surface afterwards.
 */
[data-hero-part] {
  animation: hero-part-in 900ms var(--cosmos-ease-out) both;
  animation-delay: calc(var(--i, 0) * 80ms + 60ms);
}

[data-hero-ambient] {
  animation: hero-part-fade 700ms var(--cosmos-ease-out) 520ms both;
}

@keyframes hero-part-in {
  from {
    opacity: 0;
    filter: blur(6px);
    transform: translateY(12px);
  }
}

@keyframes hero-part-fade {
  from {
    opacity: 0;
  }
}

/*
 * Return visit: no M01. The copy arrives with the main layer; captions tied
 * to the planet wait until the camera is home (1200 ms), so they never float
 * beside a planet still in flight.
 */
.home--return [data-hero-part] {
  animation: none;
}

.home--return [data-hero-ambient] {
  animation: hero-part-fade 400ms var(--cosmos-ease-out) 1000ms both;
}

/* The strip holds the pause control: keyboard focus never lands on an invisible button. */
.home--return [data-hero-ambient]:focus-within {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  [data-hero-part],
  [data-hero-ambient] {
    animation: hero-part-fade 200ms linear both;
    animation-delay: 0ms;
  }

  .home--return [data-hero-part] {
    animation: none;
  }

  .home--return [data-hero-ambient] {
    animation: hero-part-fade 200ms linear both;
  }
}
</style>
