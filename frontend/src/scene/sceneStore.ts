import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CompositionName } from './compositions'
import type { QualityTier } from './quality'

/**
 * pending  — not decided yet (first paint shows the poster);
 * poster   — static tier, the poster is the final picture;
 * webgl    — SceneDirector is rendering;
 * fallback — WebGL failed or the context was lost, poster again.
 */
export type SceneState = 'pending' | 'poster' | 'webgl' | 'fallback'

/** UI-side view of the scene. WebGL is never a source of truth for product state. */
export const useSceneStore = defineStore('scene', () => {
  const composition = ref<CompositionName>('hero')
  const state = ref<SceneState>('pending')
  const tier = ref<QualityTier | null>(null)

  function compose(name: CompositionName) {
    composition.value = name
  }

  return { composition, state, tier, compose }
})
