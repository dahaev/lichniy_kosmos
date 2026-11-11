import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'

import { compositions, type CompositionName, type SceneOrientation } from './compositions'
import type { SceneFrame } from './layout'
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

/** UI-side view of the scene. WebGL is never a source of truth for product state. */
export const useSceneStore = defineStore('scene', () => {
  const composition = ref<CompositionName>('hero')
  const state = ref<SceneState>('pending')
  const tier = ref<QualityTier | null>(null)
  const orientation = ref<SceneOrientation>('landscape')
  /** Current viewport frame; screens read planet geometry from CSS variables instead. */
  const frame = shallowRef<SceneFrame | null>(null)
  /**
   * Ambient motion is stopped (WCAG 2.2.2). Starts stopped under
   * prefers-reduced-motion; the visitor's own choice wins for the session.
   */
  const motionPaused = ref(storedPause() ?? prefersReducedMotion())

  const active = computed(() => compositions[composition.value][orientation.value])

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

  return { composition, state, tier, orientation, frame, motionPaused, active, compose, toggleMotion }
})
