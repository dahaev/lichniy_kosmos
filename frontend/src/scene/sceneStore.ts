import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'

import { compositions, type CompositionName, type SceneComposition, type SceneOrientation } from './compositions'
import { computeFrame, type SceneFrame, type Size } from './layout'
import { plates } from './plates'
import type { QualityTier } from './quality'

/**
 * pending  — not decided yet (first paint shows the poster);
 * poster   — static tier, the poster is the final picture;
 * webgl    — SceneDirector is rendering;
 * fallback — WebGL failed or the context was lost, poster again.
 */
export type SceneState = 'pending' | 'poster' | 'webgl' | 'fallback'

const PAUSE_KEY = 'cosmos.scene.paused'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function storedPause(): boolean | null {
  try {
    const value = sessionStorage.getItem(PAUSE_KEY)
    return value === null ? null : value === '1'
  } catch {
    return null
  }
}

export function frameOf(viewport: Size, composition: SceneComposition): SceneFrame {
  return computeFrame(viewport, composition.design, composition.planet, plates[composition.plate], composition.coverage)
}

/** UI-side view of the scene. WebGL is never a source of truth for product state. */
export const useSceneStore = defineStore('scene', () => {
  const composition = ref<CompositionName>('hero')
  const state = ref<SceneState>('pending')
  const tier = ref<QualityTier | null>(null)
  const orientation = ref<SceneOrientation>('landscape')
  /** Measured viewport of the scene; null until CosmosCanvas has mounted. */
  const viewport = shallowRef<Size | null>(null)
  /**
   * Ambient motion is stopped (WCAG 2.2.2). Starts stopped under
   * prefers-reduced-motion; the visitor's own choice wins for the session.
   */
  const motionPaused = ref(storedPause() ?? prefersReducedMotion())

  const active = computed(() => compositions[composition.value][orientation.value])

  /**
   * Frame of any composition for the current viewport. A screen pinned to
   * its own composition (the hero) reads it here, so it keeps its layout
   * while the scene already flies to the next screen.
   */
  function frameFor(name: CompositionName): SceneFrame | null {
    return viewport.value ? frameOf(viewport.value, compositions[name][orientation.value]) : null
  }

  /** Frame the scene is at, or flying to. Screens read planet geometry from CSS variables instead. */
  const frame = computed(() => frameFor(composition.value))

  watch(motionPaused, (paused) => {
    try {
      sessionStorage.setItem(PAUSE_KEY, paused ? '1' : '0')
    } catch {
      // Private mode without storage: the choice lasts until reload.
    }
  })

  function compose(name: CompositionName) {
    composition.value = name
  }

  function toggleMotion() {
    motionPaused.value = !motionPaused.value
  }

  return { composition, state, tier, orientation, viewport, frame, motionPaused, active, frameFor, compose, toggleMotion }
})
