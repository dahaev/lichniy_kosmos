import { qualityTiers, type QualityTier } from './quality'

/**
 * Deterministic scene mode for visual snapshots (ARCHITECTURE_MVP_v2 §17.3):
 * `?scene=freeze` in development builds only. Production ignores the flag.
 */
export function isDeterministicScene(search: string): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(search).get('scene') === 'freeze'
}

/** `?tier=static|low|medium|high` forces a quality tier in development builds, e.g. to test the poster. */
export function forcedQualityTier(search: string): QualityTier | null {
  if (!import.meta.env.DEV) return null
  const value = new URLSearchParams(search).get('tier')
  return qualityTiers.find((tier) => tier === value) ?? null
}
